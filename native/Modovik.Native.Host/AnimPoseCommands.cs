using System.Globalization;
using CodeWalker.GameFiles;

namespace Modovik.Native.Host;

/// <summary>
/// Поза из клипа игры — режим «В руках» мастерской оружия (ТЗ 06.10.2026,
/// вечер, задача 2).
///
/// Персонаж мастерской стоит не в позе, придуманной на глаз, а в той, что
/// играет сама GTA: клип словаря анимаций игрока (`.ycd`) читается здесь и
/// отдаёт на нужном кадре локальные повороты и смещения костей по их тегам
/// (`SKEL_R_UpperArm` — 40269 и т. д.). Окно накладывает их на скелет
/// `mp_m_freemode_01.yft` и ставит в руку ствол — на кость `PH_R_Hand`, как
/// это делает игра.
///
/// Без `--clip` команда отдаёт список клипов словаря — так находится нужный.
/// Игру команда не трогает: на входе файл клипа, на выходе JSON.
/// </summary>
internal static class AnimPoseCommands
{
    private const int MaxBytes = 32 * 1024 * 1024;

    /* Дорожки клипа: 0 — смещение кости, 1 — поворот. Остальные (масштаб,
       мимика, «мувер») позе персонажа не нужны. */
    private const byte TrackTranslation = 0;
    private const byte TrackRotation = 1;

    public static object Sample(string input, string? clipName, string? timeText)
    {
        var info = new FileInfo(input);
        if (info.Length > MaxBytes) throw new InvalidDataException($"{info.Name}: клип больше {MaxBytes} байт.");
        var bytes = File.ReadAllBytes(input);
        var ycd = new YcdFile { Name = info.Name };
        RpfFile.LoadResourceFile(ycd, bytes, 46);
        if (ycd.ClipDictionary is null) throw new InvalidDataException($"{info.Name}: не словарь клипов.");

        var clips = (ycd.ClipMapEntries ?? Array.Empty<ClipMapEntry>())
            .Where(entry => entry?.Clip is not null)
            .Select(entry => entry.Clip)
            .ToArray();
        var names = clips
            .Select(clip => clip.ShortName ?? clip.Name ?? "")
            .Where(name => name.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (string.IsNullOrWhiteSpace(clipName)) return new { file = info.Name, clips = names };

        var clip = clips.FirstOrDefault(item =>
            string.Equals(item.ShortName, clipName, StringComparison.OrdinalIgnoreCase)
            || string.Equals(item.Name, clipName, StringComparison.OrdinalIgnoreCase));
        if (clip is null) throw new KeyNotFoundException($"{info.Name}: клипа «{clipName}» нет.");

        Animation? animation;
        float start;
        float end;
        switch (clip)
        {
            case ClipAnimation single:
                animation = single.Animation;
                start = single.StartTime;
                end = single.EndTime;
                break;
            case ClipAnimationList list when list.Animations?.Data is { Count: > 0 } entries:
                animation = entries[0].Animation;
                start = entries[0].StartTime;
                end = entries[0].EndTime;
                break;
            default:
                throw new InvalidDataException($"{info.Name}: у клипа «{clipName}» нет анимации костей.");
        }
        if (animation?.BoneIds?.data_items is not { Length: > 0 } boneIds || animation.Sequences?.data_items is null)
            throw new InvalidDataException($"{info.Name}: клип «{clipName}» пуст.");

        var offset = float.TryParse(timeText, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0f;
        var time = Math.Clamp(start + offset, start, Math.Max(start, end));
        var frame = animation.GetFramePosition(time);
        frame.Frame0 = Math.Clamp(frame.Frame0, 0, Math.Max(0, animation.Frames - 1));

        var bones = new List<object>();
        for (var index = 0; index < boneIds.Length; index += 1)
        {
            var id = boneIds[index];
            if (id.Track == TrackRotation)
            {
                var q = animation.EvaluateQuaternion(frame, index, false);
                if (!Finite(q.X, q.Y, q.Z, q.W)) continue;
                bones.Add(new { tag = id.BoneId, track = "rotation", value = new[] { q.X, q.Y, q.Z, q.W } });
            }
            else if (id.Track == TrackTranslation)
            {
                var v = animation.EvaluateVector4(frame, index, false);
                if (!Finite(v.X, v.Y, v.Z)) continue;
                bones.Add(new { tag = id.BoneId, track = "translation", value = new[] { v.X, v.Y, v.Z } });
            }
        }
        return new
        {
            file = info.Name,
            clip = clip.ShortName ?? clip.Name,
            frames = (int)animation.Frames,
            duration = animation.Duration,
            time,
            bones,
        };
    }

    private static bool Finite(params float[] values) => values.All(float.IsFinite);
}
