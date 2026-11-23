/*
 * Шейдеры «Стиля мира» на весь экран (задача 38, 19.10.2026): «Рисованный», «Мультяшный», «Акварель» и «Ретро» —
 * так же, как «Комикс» (`ASTRAL_COMIC_FX` в `reshade.js`, проверен владельцем в игре): каждый стиль — свой
 * самостоятельный файл ReShade с одной техникой и одним проходом. Свой файл на стиль, а не один общий: если ReShade
 * не соберёт один из них, остальные и проверенные `Astral.fx` и `AstralComic.fx` продолжают работать. Файл ставится
 * только пока выбран его стиль.
 *
 * Правило — то же, что у текстурных стилей (`texture-styles.js`), пересчитанное на готовый кадр: сглаживание [1 2 1]²
 * по девяти выборкам, ступени яркости, контур по оператору Собеля, зерно бумаги. Различия, ради которых это быстро и
 * безопасно по правилам Majestic:
 *   • ступени — по корню яркости (в тенях их больше, ночь не обрушивается в чёрное) и так, что тёмное (яркость до 0,45)
 *     светлее не становится: переход на ступень берётся не выше исходного положения; светлое подтягивается, как у комикса;
 *   • контур и зерно только темнят: у линии цвет не светлее самого пикселя (`min`), зерно — множитель меньше единицы;
 *   • тяжёлых проходов нет: у каждого стиля 9 выборок, у «Ретро» 4, всё в один проход; размытие акварели — разрежённое
 *     (шаг в два пикселя), а не настоящее;
 *   • насыщенность и контраст каждому стилю даёт `AstralColor` пресета (`Astral.fx`, проверен в игре 05.10), а не его шейдер.
 * Прямой код без ветвлений: порт на процессоре (`reshade-emulation.js`) проверяется тестом по самому тексту каждого
 * шейдера (разборщик HLSL в `tests/reshade-emulation.test.js`); синтаксис и типы — настоящим компилятором D3D
 * (`d3dcompiler_47`, ps_5_0 и vs_5_0). В игре эти четыре шейдера не проверены.
 */

/* Вершинный шейдер ReShade — один и тот же, имя у каждого файла своё. */
const vertexShader = (name) => `void ${name}(in uint id : SV_VertexID, out float4 position : SV_Position, out float2 texcoord : TEXCOORD)
{
	texcoord.x = (id == 2) ? 2.0 : 0.0;
	texcoord.y = (id == 1) ? 2.0 : 0.0;
	position = float4(texcoord * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
}`;

/* Девять выборок вокруг точки: цвет в `tl … br`, середина — `c`. */
const taps = (sampler, step) => `	float3 c = tex2D(${sampler}, uv).rgb;
	float3 tl = tex2D(${sampler}, uv + px * ${step} * float2(-1.0, -1.0)).rgb;
	float3 tc = tex2D(${sampler}, uv + px * ${step} * float2(0.0, -1.0)).rgb;
	float3 tr = tex2D(${sampler}, uv + px * ${step} * float2(1.0, -1.0)).rgb;
	float3 ml = tex2D(${sampler}, uv + px * ${step} * float2(-1.0, 0.0)).rgb;
	float3 mr = tex2D(${sampler}, uv + px * ${step} * float2(1.0, 0.0)).rgb;
	float3 bl = tex2D(${sampler}, uv + px * ${step} * float2(-1.0, 1.0)).rgb;
	float3 bc = tex2D(${sampler}, uv + px * ${step} * float2(0.0, 1.0)).rgb;
	float3 br = tex2D(${sampler}, uv + px * ${step} * float2(1.0, 1.0)).rgb;`;

/* Градиент Собеля по яркости восьми соседей; `luma` — имя функции яркости файла. */
const sobel = (luma) => `	float gx = (${luma}(tr) + 2.0 * ${luma}(mr) + ${luma}(br)) - (${luma}(tl) + 2.0 * ${luma}(ml) + ${luma}(bl));
	float gy = (${luma}(bl) + 2.0 * ${luma}(bc) + ${luma}(br)) - (${luma}(tl) + 2.0 * ${luma}(tc) + ${luma}(tr));`;

const SMOOTHING = "(tl + 2.0 * tc + tr + 2.0 * ml + 4.0 * c + 2.0 * mr + bl + 2.0 * bc + br) / 16.0";

const header = (file, title) => `// ${file} — ${title} на весь кадр для ReShade (Astral).
// Написан для Astral; самостоятельный файл, ReShade.fxh ему не нужен.
`;

const backBuffer = (prefix) => `texture ${prefix}BackBufferTex : COLOR;
sampler ${prefix}BackBuffer { Texture = ${prefix}BackBufferTex; };`;

const lumaFunction = (prefix) => `float ${prefix}Luma(float3 c)
{
	return dot(c, float3(0.2126, 0.7152, 0.0722));
}`;

/*
 * «Рисованный»: мягкие мазки (восемь ступеней яркости, плавный переход), тонкий тёплый контур, бумажная фактура.
 * `PaintedBands` — число ступеней минус одна, `PaintedEdge` — сила контура, `PaintedPaper` — сила зерна бумаги.
 */
export const ASTRAL_PAINTED_FX = `${header("AstralPainted.fx", "«Рисованный»")}
uniform float PaintedBands < ui_type = "slider"; ui_min = 3.0; ui_max = 10.0; ui_label = "Bands"; ui_category = "Painted"; > = 7.0;
uniform float PaintedEdge < ui_type = "slider"; ui_min = 0.0; ui_max = 1.0; ui_label = "Outline"; ui_category = "Painted"; > = 0.6;
uniform float PaintedPaper < ui_type = "slider"; ui_min = 0.0; ui_max = 1.0; ui_label = "Paper"; ui_category = "Painted"; > = 0.5;

${backBuffer("AstralPainted")}

${vertexShader("AstralPaintedVS")}

${lumaFunction("AstralPainted")}

float3 PS_AstralPainted(float4 pos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float2 px = float2(BUFFER_RCP_WIDTH, BUFFER_RCP_HEIGHT);
${taps("AstralPaintedBackBuffer", "1.0")}
	float3 soft = ${SMOOTHING};
	float l = AstralPaintedLuma(soft);
	float p = sqrt(l) * PaintedBands;
	float fl = floor(p);
	float t = saturate((p - fl - 0.5) * 3.0 + 0.5);
	float sb = t * t * (3.0 - 2.0 * t);
	float s = lerp(min(sb, p - fl), sb, smoothstep(0.45, 0.75, l));
	float q = (fl + s) / PaintedBands;
	soft *= q * q / max(l, 0.0001);
${sobel("AstralPaintedLuma")}
	float outline = smoothstep(0.1, 0.4, length(float2(gx, gy)));
	soft = lerp(soft, min(soft, float3(0.18, 0.125, 0.1)), PaintedEdge * outline);
	float grain = frac(sin(dot(uv * float2(BUFFER_WIDTH, BUFFER_HEIGHT), float2(12.9898, 78.233))) * 43758.5453);
	soft *= 1.0 - PaintedPaper * 0.08 * grain;
	return saturate(soft);
}

technique AstralPainted < ui_label = "Astral: Painted"; >
{
	pass { VertexShader = AstralPaintedVS; PixelShader = PS_AstralPainted; }
}
`;

/*
 * «Мультяшный»: яркие плоские цвета (шесть ступеней), мягкий контур тёмнее собственного цвета. Яркость середины
 * подтягивается чуть выше, но только у светлого. Насыщенность — `AstralColor` пресета.
 */
export const ASTRAL_CARTOON_FX = `${header("AstralCartoon.fx", "«Мультяшный»")}
uniform float CartoonBands < ui_type = "slider"; ui_min = 2.0; ui_max = 10.0; ui_label = "Bands"; ui_category = "Cartoon"; > = 5.0;
uniform float CartoonEdge < ui_type = "slider"; ui_min = 0.0; ui_max = 1.0; ui_label = "Outline"; ui_category = "Cartoon"; > = 0.65;

${backBuffer("AstralCartoon")}

${vertexShader("AstralCartoonVS")}

${lumaFunction("AstralCartoon")}

float3 PS_AstralCartoon(float4 pos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float2 px = float2(BUFFER_RCP_WIDTH, BUFFER_RCP_HEIGHT);
${taps("AstralCartoonBackBuffer", "1.0")}
	float3 soft = ${SMOOTHING};
	float l = AstralCartoonLuma(soft);
	float p = sqrt(l) * CartoonBands;
	float fl = floor(p);
	float t = saturate((p - fl - 0.5) * 2.0 + 0.5);
	float sb = t * t * (3.0 - 2.0 * t);
	float keep = smoothstep(0.45, 0.75, l);
	float s = lerp(min(sb, p - fl), sb, keep);
	float q = (fl + s) / CartoonBands;
	float shade = q * q + keep * q * q * (1.0 - q * q) * 0.125;
	soft *= shade / max(l, 0.0001);
${sobel("AstralCartoonLuma")}
	float outline = smoothstep(0.1, 0.4, length(float2(gx, gy)));
	soft *= 1.0 - CartoonEdge * outline;
	return saturate(soft);
}

technique AstralCartoon < ui_label = "Astral: Cartoon"; >
{
	pass { VertexShader = AstralCartoonVS; PixelShader = PS_AstralCartoon; }
}
`;

/*
 * «Акварель»: размытые заливки (разрежённое сглаживание с шагом в два пикселя), мягкие ступени яркости, бумага светлит
 * светлое (до `WatercolorWash` к белому, тёмное — не светлит), влажный край пигмента, зерно бумаги.
 */
export const ASTRAL_WATERCOLOR_FX = `${header("AstralWatercolor.fx", "«Акварель»")}
uniform float WatercolorBands < ui_type = "slider"; ui_min = 3.0; ui_max = 10.0; ui_label = "Bands"; ui_category = "Watercolor"; > = 7.0;
uniform float WatercolorWash < ui_type = "slider"; ui_min = 0.0; ui_max = 0.5; ui_label = "Paper wash"; ui_category = "Watercolor"; > = 0.14;
uniform float WatercolorEdge < ui_type = "slider"; ui_min = 0.0; ui_max = 1.0; ui_label = "Wet edge"; ui_category = "Watercolor"; > = 0.4;
uniform float WatercolorPaper < ui_type = "slider"; ui_min = 0.0; ui_max = 1.0; ui_label = "Paper"; ui_category = "Watercolor"; > = 0.5;

${backBuffer("AstralWatercolor")}

${vertexShader("AstralWatercolorVS")}

${lumaFunction("AstralWatercolor")}

float3 PS_AstralWatercolor(float4 pos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float2 px = float2(BUFFER_RCP_WIDTH, BUFFER_RCP_HEIGHT);
${taps("AstralWatercolorBackBuffer", "2.0")}
	float3 wash = ${SMOOTHING};
	float l = AstralWatercolorLuma(wash);
	float p = sqrt(l) * WatercolorBands;
	float fl = floor(p);
	float t = saturate((p - fl - 0.5) * 2.0 + 0.5);
	float sb = t * t * (3.0 - 2.0 * t);
	float light = smoothstep(0.45, 0.8, l);
	float s = lerp(min(sb, p - fl), sb, smoothstep(0.45, 0.75, l));
	float q = (fl + s) / WatercolorBands;
	wash *= q * q / max(l, 0.0001);
	wash += (1.0 - wash) * WatercolorWash * light;
${sobel("AstralWatercolorLuma")}
	float rim = smoothstep(0.05, 0.25, length(float2(gx, gy)));
	wash *= 1.0 - WatercolorEdge * rim;
	float grain = frac(sin(dot(floor(uv * float2(BUFFER_WIDTH, BUFFER_HEIGHT) / 2.0), float2(12.9898, 78.233))) * 43758.5453);
	wash *= 1.0 - WatercolorPaper * 0.06 * grain;
	return saturate(wash);
}

technique AstralWatercolor < ui_label = "Astral: Watercolor"; >
{
	pass { VertexShader = AstralWatercolorVS; PixelShader = PS_AstralWatercolor; }
}
`;

/*
 * «Ретро»: крупные пиксели и ограниченная палитра — восемь ступеней яркости и цвет крупными шагами. Блок — два пикселя
 * на каждые 540 строк кадра (4 на 1080p); цвет блока — среднее четырёх центральных пикселей (четыре выборки точно по
 * центрам пикселей). Яркость блока — по корню яркости, тёмное вниз, светлое по ближайшей ступени; цвет — отклонение от
 * яркости, округлённое до шага `RetroChroma`, с поправкой, чтобы яркость блока осталась ровно на ступени.
 */
export const ASTRAL_RETRO_FX = `${header("AstralRetro.fx", "«Ретро»")}
uniform float RetroSteps < ui_type = "slider"; ui_min = 3.0; ui_max = 12.0; ui_label = "Levels"; ui_category = "Retro"; > = 7.0;
uniform float RetroChroma < ui_type = "slider"; ui_min = 0.02; ui_max = 0.3; ui_label = "Colour step"; ui_category = "Retro"; > = 0.11;

${backBuffer("AstralRetro")}

${vertexShader("AstralRetroVS")}

${lumaFunction("AstralRetro")}

float3 PS_AstralRetro(float4 pos : SV_Position, float2 uv : TEXCOORD) : SV_Target
{
	float2 px = float2(BUFFER_RCP_WIDTH, BUFFER_RCP_HEIGHT);
	float block = max(2.0, 2.0 * floor(BUFFER_HEIGHT / 540.0 + 0.5));
	float2 cell = floor(uv * float2(BUFFER_WIDTH, BUFFER_HEIGHT) / block);
	float2 base = cell * block + block * 0.5;
	float3 a = tex2D(AstralRetroBackBuffer, (base + float2(-0.5, -0.5)) * px).rgb;
	float3 b = tex2D(AstralRetroBackBuffer, (base + float2(0.5, -0.5)) * px).rgb;
	float3 d = tex2D(AstralRetroBackBuffer, (base + float2(-0.5, 0.5)) * px).rgb;
	float3 e = tex2D(AstralRetroBackBuffer, (base + float2(0.5, 0.5)) * px).rgb;
	float3 c = (a + b + d + e) * 0.25;
	float l = AstralRetroLuma(c);
	float keep = smoothstep(0.45, 0.75, l);
	float q = floor(sqrt(l) * RetroSteps + 0.5 * keep) / RetroSteps;
	float3 snapped = floor((c - l) / RetroChroma + 0.5) * RetroChroma;
	float3 painted = q * q + snapped - AstralRetroLuma(snapped);
	return saturate(painted);
}

technique AstralRetro < ui_label = "Astral: Retro"; >
{
	pass { VertexShader = AstralRetroVS; PixelShader = PS_AstralRetro; }
}
`;
