const dragonWeaponMod = ({
  id,
  name,
  subcategory,
  catalogSlot,
  weapon,
  rpf,
  sizeBytes,
  sha256,
  signature,
  tone = "blue",
}) => ({
  id,
  name: `DRAGON ${name}`,
  author: "DRAGON",
  description: `Независимая модель ${name} из DRAGON gunpack. Astral подключает её отдельным RPF через update/content.xml и удаляет без затрагивания других слотов.`,
  category: "gunpacks",
  categoryLabel: "Оружие",
  catalogCategory: "skins",
  catalogSubcategory: subcategory,
  catalogSection: "gunpacks",
  catalogSlot,
  platforms: ["gta5rp", "majestic"],
  platformLabel: "RAGE MP • Legacy",
  icon: "Crosshair",
  tone,
  rating: "5.0",
  downloads: "0",
  likes: "0",
  sizeBytes,
  editions: ["Legacy"],
  packageStatus: "ready",
  isNew: true,
  publishedAt: "2026-08-10",
  cover: `/assets/catalog/weapons-mods/${id}.png`,
  model: `/assets/catalog/weapons-3d/${id}.glb`,
  packageBaseUrl: `http://127.0.0.1:4174/api/packages/${id}/2.0.0/`,
  manifest: {
    id,
    version: "2.0.0",
    adapter: "rpf-entry",
    editions: ["Legacy"],
    requiresLoader: false,
    gameplayChanges: true,
    scope: "game-root",
    capabilities: [
      "rpf-container-entry-v1",
      "astral-content-rpf-v1",
      "direct-update-rpf-v1",
      "direct-update-entries-v1",
    ],
    slots: [`weapon-${weapon}`],
    files: [
      {
        source: `payload/000-${rpf}`,
        target: "update/update.rpf",
        action: "import",
        entry: `x64/astral/${rpf}`,
        size: sizeBytes,
        sha256,
      },
    ],
    signature,
  },
});

export const catalog = {
  platforms: [
    { id: "gta5rp", name: "GTA 5 RP", short: "RAGE MP", color: "#ff6038" },
    { id: "majestic", name: "Majestic", short: "ROLE PLAY", color: "#bd6bff" },
    { id: "redux", name: "Redux", short: "GRAPHICS", color: "#c8ff32" },
    { id: "story", name: "Одиночная", short: "STORY", color: "#53a8ff" },
  ],
  categories: [
    { id: "redux", name: "Редуксы" },
    { id: "gunpacks", name: "Ганпаки" },
    { id: "clothing", name: "Одежда" },
    { id: "other", name: "Другое" },
  ],
  // Публичный каталог начинается пустым. Реальные модификации появляются
  // только после публикации из админ-панели с явным разделом и слотом.
  // Два внутренних пакета остаются исключительно для проверки движка.
  mods: [
    {
      id: "dragon-minimap",
      name: "DRAGON Minimap",
      author: "DRAGON",
      description:
        "Тёмная контрастная мини-карта для GTA V Legacy. Устанавливается точечно в scaleform_minimap.rpf с автоматическим резервным копированием и откатом.",
      category: "redux",
      categoryLabel: "Мини-карты",
      catalogCategory: "interface",
      catalogSubcategory: "Мини-карты",
      catalogSection: "redux",
      catalogSlot: "minimap",
      platforms: ["gta5rp", "majestic"],
      platformLabel: "RAGE MP • Legacy",
      icon: "Map",
      tone: "blue",
      rating: "5.0",
      downloads: "0",
      likes: "0",
      sizeBytes: 216954,
      editions: ["Legacy"],
      packageStatus: "ready",
      isNew: true,
      publishedAt: "2026-08-10",
      cover: "/assets/workshop/minimap/dragon-card.png",
      gallery: [
        "/assets/workshop/minimap/dragon-hero.png",
        "/assets/workshop/minimap/dragon-card.png",
      ],
      packageBaseUrl:
        "http://127.0.0.1:4174/api/packages/dragon-minimap/3.0.1/",
      manifest: {
        id: "dragon-minimap",
        version: "3.0.1",
        adapter: "rpf-entry",
        editions: ["Legacy"],
        requiresLoader: false,
        gameplayChanges: false,
        scope: "game-root",
        capabilities: ["rpf-container-entry-v1", "direct-update-entries-v1"],
        slots: ["minimap"],
        files: [
          {
            source: "payload/minimap.gfx",
            target: "update/update.rpf",
            entry: "x64/patch/data/cdimages/scaleform_minimap.rpf/minimap.gfx",
            size: 216954,
            sha256:
              "8444f717a60bb52f7383ad10add429702663d3caf3cbbef6414903e93e85afb6",
          },
        ],
        signature:
          "V0WcNebk2ygLsna2JEJjycGhSU1Asd7JuqNeYYDPaOJ+pl/L8PKw+itONaX8gqshspqUSxU9/TMk035i6qlrCQ==",
      },
    },
    {
      id: "dragon-revolver",
      name: "DRAGON Revolver",
      author: "DRAGON",
      description:
        "Отдельная модель Heavy Revolver из DRAGON gunpack. Ставится в независимый управляемый DLC и удаляется без затрагивания других стволов.",
      category: "gunpacks",
      categoryLabel: "Оружие",
      catalogCategory: "skins",
      catalogSubcategory: "Револьверы",
      catalogSection: "gunpacks",
      catalogSlot: "revolver",
      platforms: ["gta5rp", "majestic"],
      platformLabel: "RAGE MP • Legacy",
      icon: "Crosshair",
      tone: "purple",
      rating: "5.0",
      downloads: "0",
      likes: "0",
      sizeBytes: 4708605,
      editions: ["Legacy"],
      packageStatus: "ready",
      isNew: true,
      publishedAt: "2026-08-10",
      cover: "/assets/catalog/weapons-mods/dragon-revolver.png",
      model: "/assets/catalog/weapons-3d/dragon-revolver.glb",
      packageBaseUrl:
        "http://127.0.0.1:4174/api/packages/dragon-revolver/2.0.0/",
      manifest: {
        id: "dragon-revolver",
        version: "2.0.0",
        adapter: "rpf-entry",
        editions: ["Legacy"],
        requiresLoader: false,
        gameplayChanges: true,
        scope: "game-root",
        capabilities: [
          "rpf-container-entry-v1",
          "astral-content-rpf-v1",
          "direct-update-rpf-v1",
          "direct-update-entries-v1",
        ],
        slots: ["weapon-w_pi_revolver"],
        files: [
          {
            source: "payload/000-astral_weapon_revolver.rpf",
            target: "update/update.rpf",
            action: "import",
            entry: "x64/astral/astral_weapon_revolver.rpf",
            size: 4708605,
            sha256:
              "cfd80a65c9047d3010f9a1024abaf47e6e1f67ef51db46a3b0f07e39437ad2d2",
          },
        ],
        signature:
          "saULR42CBFE7SQKAj8yQwwLOormRzk3/RmC5rWiLNv2/wja1n/53EwjOT8BNp2Hy7L/HcOwqfl49KxuSdKSTDw==",
      },
    },
    {
      id: "dragon-carbine-rifle",
      name: "DRAGON Carbine Rifle",
      author: "DRAGON",
      description:
        "Отдельная модель Carbine Rifle из DRAGON gunpack. Независимый DLC позволяет сочетать её с револьвером и откатывать каждый слот отдельно.",
      category: "gunpacks",
      categoryLabel: "Оружие",
      catalogCategory: "skins",
      catalogSubcategory: "Винтовки",
      catalogSection: "gunpacks",
      catalogSlot: "carbine-rifle",
      platforms: ["gta5rp", "majestic"],
      platformLabel: "RAGE MP • Legacy",
      icon: "Crosshair",
      tone: "blue",
      rating: "5.0",
      downloads: "0",
      likes: "0",
      sizeBytes: 9901283,
      editions: ["Legacy"],
      packageStatus: "ready",
      isNew: true,
      publishedAt: "2026-08-10",
      cover: "/assets/catalog/weapons-mods/dragon-carbine-rifle.png",
      model: "/assets/catalog/weapons-3d/dragon-carbine-rifle.glb",
      packageBaseUrl:
        "http://127.0.0.1:4174/api/packages/dragon-carbine-rifle/2.0.0/",
      manifest: {
        id: "dragon-carbine-rifle",
        version: "2.0.0",
        adapter: "rpf-entry",
        editions: ["Legacy"],
        requiresLoader: false,
        gameplayChanges: true,
        scope: "game-root",
        capabilities: [
          "rpf-container-entry-v1",
          "astral-content-rpf-v1",
          "direct-update-rpf-v1",
          "direct-update-entries-v1",
        ],
        slots: ["weapon-w_ar_carbinerifle"],
        files: [
          {
            source: "payload/000-astral_weapon_carbinerifle.rpf",
            target: "update/update.rpf",
            action: "import",
            entry: "x64/astral/astral_weapon_carbinerifle.rpf",
            size: 9901283,
            sha256:
              "ed80d4e7b8fe05024b9118fca46156564f1fa4c3193c4405a05c2c338322c257",
          },
        ],
        signature:
          "xxTg3HGgGZA1kx7b5tmyoK9+x1h1Z4oGouiQrymFHGdbKQAz+YbfvVb2BNPdwLnQrD4+u37b2L8WZDjz+yy1BQ==",
      },
    },
    dragonWeaponMod({
      id: "dragon-special-carbine",
      name: "Special Carbine",
      subcategory: "Винтовки",
      catalogSlot: "special-carbine",
      weapon: "w_ar_specialcarbine",
      rpf: "astral_weapon_specialcarbine.rpf",
      sizeBytes: 10309792,
      sha256:
        "f3c7cfd6b793c5b6add38e8effdf58d3babafdb5a4917c5077496834d8faaaed",
      signature:
        "jnfjQdMzPBhUJjME0L12g0szcbOnr6XFHlgv96lTFpSCPz2A+UiRvx6o28PLQTKIjl/unHwr3sQy3qRDzit1DQ==",
    }),
    dragonWeaponMod({
      id: "dragon-mini-smg",
      name: "Mini SMG",
      subcategory: "Пистолеты-пулемёты",
      catalogSlot: "mini-smg",
      weapon: "w_sb_minismg",
      rpf: "astral_weapon_minismg.rpf",
      sizeBytes: 5910186,
      sha256:
        "52904906ce8caf79d6ca8ff9e1e8054c9c4f328695fd555a20098667e0bc5b12",
      signature:
        "BASA3AHqygSEdTPRFKtYimcE5QwGRxJvlPZTYTixmqH58EjCtR42758g0sJdFTUQ9yNB8iu5jh4jmBIriVvUBg==",
      tone: "purple",
    }),
    dragonWeaponMod({
      id: "dragon-assault-shotgun",
      name: "Assault Shotgun",
      subcategory: "Дробовики",
      catalogSlot: "assault-shotgun",
      weapon: "w_sg_assaultshotgun",
      rpf: "astral_weapon_assaultshotgun.rpf",
      sizeBytes: 9168916,
      sha256:
        "bb747e92ac81308edf45510f3815310279802c13b012cdbb59113e1252d8bed4",
      signature:
        "n7N1AVHT5lmvujZEvwfojLMPSOipTVBMQySrFoUvAF+VLt9bH0t2O7UZS/rPtLUoIY2sn+t6E8PPXN9YGcGxCA==",
    }),
    {
      id: "safeswitch-doctor",
      name: "SafeSwitch Doctor",
      description:
        "Внутренний диагностический пакет установки и безопасного отката.",
      category: "optimization",
      categoryLabel: "Диагностика",
      catalogSection: "internal",
      internal: true,
      platforms: ["gta5rp", "majestic", "redux", "story"],
      platformLabel: "Legacy • Enhanced",
      icon: "ShieldCheck",
      tone: "blue",
      rating: "5.0",
      downloads: "0",
      editions: ["Legacy", "Enhanced"],
      packageStatus: "ready",
      cover: "/media/mod-rifle.png",
      packageBaseUrl:
        "http://127.0.0.1:4174/api/packages/safeswitch-doctor/1.1.0/",
      manifest: {
        id: "safeswitch-doctor",
        version: "1.1.0",
        adapter: "file-overlay",
        editions: ["Legacy", "Enhanced"],
        requiresLoader: false,
        gameplayChanges: false,
        scope: "mods-only",
        slots: ["modovik-health"],
        files: [
          {
            source: "payload/doctor.json",
            target: "mods/modovik/doctor.json",
            size: 175,
            sha256:
              "5ac2078496b6e13666ca763597b188c6780f1fa4018cc72f341122df2d45d850",
          },
        ],
        signature:
          "9lzXnlA7TMyZ/0MdB1hA3dmtFOxmzOQ/wlId0A36SGL7ljImwIeDkO4u8J5ZMW2lx9g1tF+zaqMDWlNcPoedCg==",
      },
    },
    {
      id: "safeswitch-beacon",
      name: "SafeSwitch Beacon",
      description: "Внутренний диагностический пакет конфликта слотов.",
      category: "optimization",
      categoryLabel: "Диагностика",
      catalogSection: "internal",
      internal: true,
      platforms: ["gta5rp", "majestic", "redux", "story"],
      platformLabel: "Legacy • Enhanced",
      icon: "ShieldCheck",
      tone: "purple",
      rating: "5.0",
      downloads: "0",
      editions: ["Legacy", "Enhanced"],
      packageStatus: "ready",
      cover: "/media/mod-rifle.png",
      packageBaseUrl:
        "http://127.0.0.1:4174/api/packages/safeswitch-beacon/1.0.0/",
      manifest: {
        id: "safeswitch-beacon",
        version: "1.0.0",
        adapter: "file-overlay",
        editions: ["Legacy", "Enhanced"],
        requiresLoader: false,
        gameplayChanges: false,
        scope: "mods-only",
        slots: ["modovik-health"],
        files: [
          {
            source: "payload/doctor.json",
            target: "mods/modovik/doctor.json",
            size: 175,
            sha256:
              "eb4044c3ac33cd55a200d2be6c97bbb9ce8dd92559498b7ff2ad15007c5ed4a3",
          },
        ],
        signature:
          "PYwJ0lnpHosAcNmkrC89lEpGElqFvOh7+RTdQgAVzc7YKUtpo2q1dK/fynlFvjsLu7x02YI/tgOQjC3DCjR8Aw==",
      },
    },
  ],
};

// Local signed packages are the release-candidate source of truth during the
// desktop test cycle. Keep the hand-written metadata as a fallback, while
// replacing matching public entries with the newest atomically built manifest.
try {
  const generated = JSON.parse(
    fs.readFileSync(
      new URL("../../runtime/local-test-mods.json", import.meta.url),
      "utf8",
    ),
  );
  const generatedById = new Map(generated.map((mod) => [mod.id, mod]));
  catalog.mods = catalog.mods.map((mod) =>
    generatedById.has(mod.id)
      ? { ...mod, ...generatedById.get(mod.id), internal: mod.internal }
      : mod,
  );
} catch {
  // Packaged production catalogs may be supplied by the API instead.
}
import fs from "node:fs";
