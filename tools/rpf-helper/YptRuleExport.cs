using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using CodeWalker.GameFiles;

namespace Modovik.RpfHelper;

/*
 * Полная выгрузка правил эффектов — для движка частиц окна мастерской.
 *
 * Выписка (`YptRuleDigest`) отдаёт сцене только то, что нужно было схеме:
 * размер, цвет, скорость. Но в игре эффект — это целая программа частиц:
 * эволюции по дальности и углу попадания, общие случайные величины частицы
 * (связи смещений), домены рождения и цели с поворотом, гашение, вращение,
 * смешение кадров листа, освещение и мягкость шейдера. Движок окна повторяет
 * RMPTFX по этим данным, а значит, ему нужны они все — без выборки.
 *
 * Поэтому здесь нет своего описания полей: каждое правило пишется тем же
 * кодом CodeWalker, что делает XML всего словаря (`WriteXml`), и XML
 * переводится в JSON один в один. Правило, которое CodeWalker умеет
 * записать, окно получает целиком; новое поле CodeWalker появится в выгрузке
 * само. Кадры свойств сжимаются в строки `[время, x, y, z, w]`: заранее
 * посчитанное игрой `1/Δt` (второй компонент времени) движку не нужно.
 *
 * Выгружаются правила эффектов по именам, все их эмиттеры и частицы и —
 * транзитивно — эффекты, которые частицы рождают сами (`EffectSpawner*`).
 * Только чтение.
 */
internal static class YptRuleExport
{
    private const int MaxRules = 128;
    private static readonly Regex RuleName =
        new("^[A-Za-z0-9_]{1,64}$", RegexOptions.CultureInvariant);

    public static object Export(YptFile ypt, IReadOnlyList<string?> names)
    {
        var list = ypt.PtfxList ?? throw new InvalidDataException("YPT particle list is missing.");
        var effectRules = (list.EffectRuleDictionary?.EffectRules?.data_items ?? [])
            .Where(item => item?.Name?.Value is not null)
            .GroupBy(item => item.Name.Value, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        var effects = new SortedDictionary<string, object?>(StringComparer.Ordinal);
        var emitters = new SortedDictionary<string, object?>(StringComparer.Ordinal);
        var particles = new SortedDictionary<string, object?>(StringComparer.Ordinal);
        var textures = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var drawables = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var meshes = new SortedDictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        var missing = new List<string>();

        var queue = new Queue<string>();
        foreach (var raw in names)
        {
            var name = raw?.Trim() ?? string.Empty;
            if (!RuleName.IsMatch(name))
                throw new InvalidDataException($"YPT rule name is invalid: {raw}");
            queue.Enqueue(name);
        }
        while (queue.Count > 0)
        {
            var name = queue.Dequeue();
            if (effects.ContainsKey(name) || missing.Contains(name)) continue;
            if (effects.Count >= MaxRules)
                throw new InvalidDataException($"YPT rule export names at most {MaxRules} rules.");
            if (!effectRules.TryGetValue(name, out var rule))
            {
                missing.Add(name);
                continue;
            }
            effects[name] = Convert(Write(sb => rule.WriteXml(sb, 1)));
            foreach (var item in (rule.EventEmitters?.data_items ?? []).Take(rule.EventEmittersCount))
            {
                var emitter = item?.EmitterRule;
                var emitterName = emitter?.Name?.Value;
                if (emitter is not null && emitterName is not null && !emitters.ContainsKey(emitterName))
                    emitters[emitterName] = Convert(Write(sb => emitter.WriteXml(sb, 1)));
                var particle = item?.ParticleRule;
                var particleName = particle?.Name?.Value;
                if (particle is null || particleName is null || particles.ContainsKey(particleName)) continue;
                particles[particleName] = Convert(Write(sb => particle.WriteXml(sb, 1, string.Empty)));
                foreach (var shaderVar in particle.ShaderVars?.data_items ?? [])
                    if (shaderVar is ParticleShaderVarTexture texture &&
                        !string.IsNullOrWhiteSpace(texture.TextureName?.Value))
                        textures.Add(texture.TextureName.Value);
                foreach (var drawable in particle.Drawables?.data_items ?? [])
                {
                    if (string.IsNullOrWhiteSpace(drawable?.Name?.Value)) continue;
                    drawables.Add(drawable.Name.Value);
                    if (meshes.ContainsKey(drawable.Name.Value) || drawable.Drawable is null) continue;
                    var mesh = ExportMesh(drawable.Drawable);
                    meshes[drawable.Name.Value] = mesh;
                    foreach (var part in mesh.Parts)
                        if (!string.IsNullOrWhiteSpace(part.Texture)) textures.Add(part.Texture);
                }
                foreach (var spawned in new[] { particle.EffectSpawnerAtRatio, particle.EffectSpawnerOnCollision })
                {
                    var spawnedName = spawned?.EffectRule?.Name?.Value;
                    if (!string.IsNullOrWhiteSpace(spawnedName) && RuleName.IsMatch(spawnedName))
                        queue.Enqueue(spawnedName);
                }
            }
        }
        return new { effects, emitters, particles, textures, drawables, meshes, missing };
    }

    /*
     * Модель частицы (ptxd_Model): сетка высокой детализации словаря эффектов
     * — вершины, нормали, координаты листа и треугольники по частям, у каждой
     * части — имя её diffuse-текстуры. Окно рисует модели частиц этими же
     * сетками (кусочки черепа у хедшота, бумага, монеты, листья, перья), а не
     * значками. Числа округляются до десятитысячных: это сантиметровые
     * кусочки, и мегабайтный ответ помощника не должен уходить на шум.
     */
    internal sealed record MeshPart(double[] Positions, double[] Normals, double[] Uvs, int[] Indices, string? Texture);
    internal sealed record Mesh(IReadOnlyList<MeshPart> Parts);

    private const int MaxMeshVertices = 20000;
    private static readonly uint DiffuseSampler = JenkHash.GenHash("diffusesampler");

    private static Mesh ExportMesh(DrawableBase drawable)
    {
        var parts = new List<MeshPart>();
        var shaders = drawable.ShaderGroup?.Shaders?.data_items ?? [];
        var total = 0;
        foreach (var model in drawable.DrawableModels?.High ?? [])
        {
            foreach (var geometry in model?.Geometries ?? [])
            {
                var data = geometry?.VertexData;
                var info = data?.Info;
                var indices = geometry?.IndexBuffer?.Indices;
                if (data?.VertexBytes is null || info is null || indices is null) continue;
                var count = data.VertexCount;
                total += count;
                if (total > MaxMeshVertices)
                    throw new InvalidDataException("YPT particle model is too large to export.");
                var positions = new double[count * 3];
                var normals = new double[count * 3];
                var uvs = new double[count * 2];
                var hasNormal = ((info.Flags >> (int)VertexSemantics.Normal) & 1) == 1;
                var hasUv = ((info.Flags >> (int)VertexSemantics.TexCoord0) & 1) == 1;
                for (var v = 0; v < count; v += 1)
                {
                    var p = data.GetVector3(v, (int)VertexSemantics.Position);
                    positions[v * 3] = Round(p.X);
                    positions[v * 3 + 1] = Round(p.Y);
                    positions[v * 3 + 2] = Round(p.Z);
                    if (hasNormal)
                    {
                        var n = ReadVector(data, info, v, (int)VertexSemantics.Normal);
                        normals[v * 3] = Round(n.X);
                        normals[v * 3 + 1] = Round(n.Y);
                        normals[v * 3 + 2] = Round(n.Z);
                    }
                    if (hasUv)
                    {
                        var (u, t) = ReadUv(data, info, v, (int)VertexSemantics.TexCoord0);
                        uvs[v * 2] = Round(u);
                        uvs[v * 2 + 1] = Round(t);
                    }
                }
                string? texture = null;
                var shaderId = geometry!.ShaderID;
                if (shaderId < shaders.Length && shaders[shaderId]?.ParametersList is { } parameters)
                {
                    var hashes = parameters.Hashes ?? [];
                    var values = parameters.Parameters ?? [];
                    for (var index = 0; index < Math.Min(hashes.Length, values.Length); index += 1)
                        if ((uint)hashes[index] == DiffuseSampler && values[index]?.Data is TextureBase diffuse)
                            texture = diffuse.Name;
                }
                parts.Add(new MeshPart(
                    positions,
                    hasNormal ? normals : [],
                    hasUv ? uvs : [],
                    indices.Select(index => (int)index).ToArray(),
                    texture));
            }
        }
        return new Mesh(parts);
    }

    private static double Round(float value) => Math.Round(value, 4);

    private static SharpDX.Vector3 ReadVector(VertexData data, VertexDeclaration info, int v, int component)
    {
        switch (info.GetComponentType(component))
        {
            case VertexComponentType.Float3: return data.GetVector3(v, component);
            case VertexComponentType.Float4:
            {
                var value = data.GetVector4(v, component);
                return new SharpDX.Vector3(value.X, value.Y, value.Z);
            }
            case VertexComponentType.RGBA8SNorm:
            {
                var value = data.GetRGBA8SNorm(v, component);
                return new SharpDX.Vector3(value.X, value.Y, value.Z);
            }
            case VertexComponentType.Half4:
            {
                var value = data.GetHalf4(v, component);
                return new SharpDX.Vector3((float)value.X, (float)value.Y, (float)value.Z);
            }
            case VertexComponentType.Colour:
            {
                var value = data.GetColour(v, component);
                return new SharpDX.Vector3(value.R / 127.5f - 1f, value.G / 127.5f - 1f, value.B / 127.5f - 1f);
            }
            default: return SharpDX.Vector3.UnitZ;
        }
    }

    private static (float, float) ReadUv(VertexData data, VertexDeclaration info, int v, int component)
    {
        switch (info.GetComponentType(component))
        {
            case VertexComponentType.Float2:
            {
                var value = data.GetVector2(v, component);
                return (value.X, value.Y);
            }
            case VertexComponentType.Half2:
            {
                var value = data.GetHalf2(v, component);
                return ((float)value.X, (float)value.Y);
            }
            default: return (0f, 0f);
        }
    }

    private static string Write(Action<StringBuilder> write)
    {
        var sb = new StringBuilder();
        sb.AppendLine("<Rule>");
        write(sb);
        sb.AppendLine("</Rule>");
        return sb.ToString();
    }

    /*
     * XML CodeWalker → JSON без потерь:
     *   <Tag value="…"/>              → число или строка;
     *   <Tag x="…" y="…" z="…" w="…"/> → массив чисел по порядку x, y, z, w;
     *   <Tag>текст</Tag>              → строка;
     *   <Tag><Item>…</Item>…</Tag>     → массив;
     *   <Keyframes>                   → [[время, x, y, z, w], …];
     *   прочее                         → объект по именам детей.
     */
    private static object? Convert(string xml)
    {
        var root = XElement.Parse(xml, LoadOptions.None);
        return ConvertElement(root);
    }

    private static readonly string[] Axes = ["x", "y", "z", "w"];

    private static object? ConvertElement(XElement element)
    {
        var children = element.Elements().ToList();
        if (element.Name.LocalName == "Keyframes")
            return children.Select(Keyframe).ToList();
        if (children.Count == 0)
        {
            var value = element.Attribute("value");
            if (value is not null) return Scalar(value.Value);
            var axes = Axes
                .Select(axis => element.Attribute(axis))
                .Where(attribute => attribute is not null)
                .Select(attribute => Number(attribute!.Value))
                .ToList();
            if (axes.Count > 0) return axes;
            // Пустой контейнер (`<Keyframes />`, `<Items />`) — пустой массив,
            // пустая строка (`<TextureName />`) — пустая строка: различить их
            // можно только по имени, а движок всё равно читает оба как «нет».
            return element.Value;
        }
        if (children.All(child => child.Name.LocalName == "Item"))
            return children.Select(ConvertElement).ToList();
        var result = new SortedDictionary<string, object?>(StringComparer.Ordinal);
        foreach (var child in children)
        {
            var key = child.Name.LocalName;
            if (!result.ContainsKey(key)) result[key] = ConvertElement(child);
        }
        return result;
    }

    private static double[] Keyframe(XElement item)
    {
        var time = item.Element("KeyframeTime");
        var value = item.Element("KeyframeValue");
        double Read(XElement? element, string axis) =>
            element?.Attribute(axis) is { } attribute ? Number(attribute.Value) : 0;
        return
        [
            Read(time, "x"),
            Read(value, "x"),
            Read(value, "y"),
            Read(value, "z"),
            Read(value, "w"),
        ];
    }

    private static object Scalar(string text)
    {
        if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase) &&
            uint.TryParse(text[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var hex))
            return hex;
        if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
            return number;
        return text;
    }

    private static double Number(string text) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            ? number
            : 0;
}
