// Offline test of the mod, run by build.ps1: node tests/test_mod.js
// It loads src/phantombladezero_mapcollectiblemarkers/main.js as PBZModLoader does (a module whose __dirname is the
// mod's folder) with stand-ins for the modules the game gives it (ue, cpp, puerts, Library/TsHelper, Library/UIHelper and
// UI/Widget/Map, whose MapInterface the mod wraps) and a small game: the region map widget with its completion lists, the
// map data, the backpack, the bells, the fog patches with their pictures, the timers, an optional running Mods Menu and
// the settings file. Like Puerts' blueprint.mixin, the game copies MapInterface's methods when the map class mixes and
// keeps that copy across a reload; engine calls (Tick, OnPreviewKeyDown) and the map script's own this.x() calls go
// through it.
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");

const FOLDER = path.join(__dirname, "..", "src", "phantombladezero_mapcollectiblemarkers");
const SCRIPT = path.join(FOLDER, "main.js");
const SETTINGS = path.join(FOLDER, "phantombladezero_mapcollectiblemarkers.txt");
const SETTINGS_PATH = FOLDER.replace(/[\\/]+$/, "") + "/phantombladezero_mapcollectiblemarkers.txt";
const MENU_PATH = "C:/Game/ProjectPBZ/Saved/PBZModsMenu/Settings/phantombladezero_mapcollectiblemarkers.txt";
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mod.json"), "utf8")).version;
const VIS = { Visible: 0, Collapsed: 1, Hidden: 2, HitTestInvisible: 3, SelfHitTestInvisible: 4 };
const HOOKS_KEY = "__mapCollectibleMarkersHooks";
const SESSION_KEY = "__mapCollectibleMarkersSession";
const METHODS = ["InitMapText", "initAdvancedSlotWidget", "getFocusCandidatesSorted", "iconCenterByID", "Tick", "switchMap"];
// the material spots in main.js (the source mod's data)
const SPOTS = (() => {
    const text = fs.readFileSync(SCRIPT, "utf8");
    const m = text.match(/const MATERIAL_SPOTS = \[\n([\s\S]*?)\n\];/);
    return JSON.parse("[" + m[1].replace(/,$/, "") + "]");
})();
const MATERIAL_TINT = "0.45,0.9,0.95";

let failed = 0;
function check(name, ok) {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) {
        failed++;
    }
}
function tarray(items = []) {
    const a = { items };
    a.Num = () => a.items.length;
    a.Get = (i) => a.items[i];
    a.GetRef = (i) => a.items[i];
    a.Add = (v) => { a.items.push(v); };
    a.Empty = () => { a.items = []; };
    a.Contains = (v) => a.items.includes(v);
    a[Symbol.iterator] = function* () { yield* a.items; };
    return a;
}
function tmap(entries) {
    const m = { entries };
    m.GetMaxIndex = () => m.entries.length;
    m.IsValidIndex = (i) => i >= 0 && i < m.entries.length;
    m.GetKey = (i) => m.entries[i][0];
    m.Get = (k) => { const e = m.entries.find((x) => x[0] === k); return e ? e[1] : undefined; };
    m.GetRef = m.Get;
    return m;
}
class Vector { constructor(x, y, z) { this.X = x; this.Y = y; this.Z = z; } }
class Vector2D {
    constructor(x, y) { this.X = x; this.Y = y; }
    op_Multiply(f) { return new Vector2D(this.X * f, this.Y * f); }
}
class LinearColor { constructor(r, g, b, a) { this.R = r; this.G = g; this.B = b; this.A = a; } }
const V = (x, y, z = 0) => new Vector(x, y, z);

// A fog picture: fog (200) inside a disc in the middle of the patch, none outside.
const fogTex = { name: "T_Fog", GetClass: () => "Texture", value: (u, v) => (Math.hypot(u - 0.5, v - 0.5) < 0.4 ? 200 : 0) };
const fogMat = { name: "M_Fog", GetClass: () => "MaterialInterface", GetName: () => "M_Fog",
    TextureParameterValues: tarray([{ ParameterInfo: { Name: "Other" }, ParameterValue: null }, { ParameterInfo: { Name: "MapAreaMask" }, ParameterValue: fogTex }]) };
function patch(x, y, res, visibility = VIS.SelfHitTestInvisible) {
    const slot = { GetPosition: () => new Vector2D(x, y), GetSize: () => new Vector2D(200, 200), GetAlignment: () => new Vector2D(0.5, 0.5) };
    return { Brush: { ResourceObject: res }, GetVisibility: () => visibility, GetRenderOpacity: () => 1, slot };
}

// The game: the map data of the shown region page (huanshushi with meigu_yiji, the Illusionist's Ruins drawn on it),
// the backpack, the bells, the save, the fog. It stays across copies of the mod.
function newGame(options = {}) {
    const game = { cycle: 1, created: 0, removed: 0, storyTag: false, taken: new Set([SPOTS.find((s) => s[0] == "MeiGu_YiJi")[1]]) };
    game.texts = { UI_Map_20: "Memory Flower", UI_Map_21: "", UI_Map_22: "", UI_Map_23: "", UI_Map_24: "", UI_Map_25: "",
        Item_Piece_001_Name: "Black Stone Fragment", Item_Piece_002_Name: "Amber Fragment", BossName_007: "Jian Chi",
        Character_LJC_12: "Weaver", BellName_1: "Ruins Bell", WName_W_1: "Sword One", WName_W_3: "Sword Three", AName_A_1: "Jade Ring",
        BrokenBell_HSSYJ_01: "", UI_Portal: "Portal" };
    game.text = (key) => (key in game.texts ? game.texts[key] : /_Material_/.test(key) ? "N:" + key.replace(/_Name$/, "") : key);
    // the completion lists W_MapItemCompletionUI shows (still missing on this page)
    game.lists = {
        DisplayHeishiData: [{ MapID: "huanshushi", Location: V(10000, 10000) }, { MapID: "huanshushi", Location: V(-1, 0) }],
        DisplayHupoData: [{ MapID: "huanshushi", Location: V(5000, 5000) }, { MapID: "huanshushi", Location: V(20000, 20000) }],
        DisplayFlowerData: [{ MapID: "huanshushi", Location: V(4100, 4100) }],
        DisplayPrimaryData: [{ MapID: "huanshushi", Location: V(30000, 30000) }, { MapID: "huanshushi", Location: V(30000, 30000) },
            { MapID: "huanshushi", Location: V(31000, 30000) }],
        DisplayYaoShiData: [{ MapID: "meigu_yiji", Location: V(36000, 30000) }],
        DisplayChallengeDatas: [{ MapID: "huanshushi", Location: V(33000, 30000), ChallengeType: 0 },
            { MapID: "huanshushi", Location: V(35000, 30000), ChallengeType: 2 }],
    };
    const entry = (fields) => Object.assign({ NodeGuids: tarray([]), SaveGuidString: "", MobDomainName: "None", FlowAssetName: "None" }, fields);
    const empty = () => ({ HeiShiItemData: tarray([]), HupoItemData: tarray([]), YaoShiItemData: tarray([]), BellDatas: tarray([]),
        WeaponItemDatas: tarray([]), ShaChiWeaponItemDatas: tarray([]), AccessoryItemDatas: tarray([]), MedicineItemDatas: tarray([]) });
    const hss = empty();
    hss.HeiShiItemData = tarray([entry({ Location: V(10000, 10000), FlowAssetName: "BPF_JianChiDeath" })]);
    hss.HupoItemData = tarray([entry({ Location: V(20000, 20000), MobDomainName: "Mob_Ruins_1" })]);
    hss.BellDatas = tarray([entry({ BellID: "Bell_HSS_01", Location: V(40000, 1000) }), entry({ BellID: "Bell_HSS_02", Location: V(40000, 2000) }),
        entry({ BellID: "bell_dp_002", Location: V(40000, 3000) })]);
    hss.WeaponItemDatas = tarray([entry({ WeaponID: "W_1", Location: V(41000, 1000), FlowAssetName: "BPF_NvZhi" }),
        entry({ WeaponID: "W_2", Location: V(42000, 1000) }), entry({ WeaponID: "W_3", Location: V(43000, 1000) }),
        entry({ WeaponID: "W_4", Location: V(30050, 30000) })]);
    hss.AccessoryItemDatas = tarray([entry({ AccessoryID: "A_1", Location: V(44000, 1000), SaveGuidString: "PBZ_Ruins_WP-BP_Chest_C_UAID_1" })]);
    hss.MedicineItemDatas = tarray([entry({ MedicineID: "M_1", Location: V(0, 0) })]);
    const fjzl = empty();
    game.asset = { MapItemDatas: tmap([["huanshushi", hss], ["meigu_yiji", empty()], ["fujizhilin", fjzl]]) };
    const owned = (pairs) => tmap(pairs.map(([id, cycle]) => [id, { AcquiredCycle: cycle }]));
    game.backPack = { MainWeaponInfos: owned([["W_2", 1], ["W_3", 0]]), ShaqiWeaponInfos: owned([]), Accessories: owned([]), MedicineInfos: owned([]),
        GetMainWeaponTableData: (id) => ({ WeaponName: { Key: "WName_" + id } }), GetShaqiWeaponTableData: (id) => ({ WeaponName: { Key: "SName_" + id } }) };
    game.subsystems = {
        PBZBackPackSubsystem: game.backPack,
        PBZGameSystem: { GetCycleCount: () => game.cycle },
        BellManager: { GetAllActivateBellIDs: () => tarray(["Bell_HSS_02"]) },
        PBZLevelActorManager: { HasSaveDataByActorID: (id) => game.taken.has(id) },
        EventPipelineManager: { HasTagWithOutSource: (tag) => (tag === "fjzl.风雪数据层.激活" ? game.storyTag : false) },
        MapSubsystem: { GetUnLockMaskIDs: (mapID) => tarray(mapID == "huanshushi" ? ["Fog_B"] : []) },
    };
    // the fog patches (screen = world / 10): A over the first Amber, B (cleared in the save) over the Black Stone, C (a
    // material whose picture is a texture parameter) over the first challenge, D (not a valid mask) over the second chest,
    // E (collapsed: cleared) over the key
    const pictures = options.fogNoPictures ? undefined : fogTex;
    game.patches = [["Fog_A", patch(500, 500, pictures)], ["Fog_B", patch(1000, 1000, pictures)],
        ["Fog_C", patch(3300, 3000, options.fogNoPictures ? undefined : fogMat)], ["Fog_D", patch(3100, 3000, pictures)],
        ["Fog_E", patch(3600, 3000, pictures, VIS.Collapsed)]];
    game.mask = { GetMaskMap: (ref) => { ref[0] = tmap(game.patches); } };
    return game;
}

// The map script's module: MapInterface with the methods the mod wraps or calls, as Map.js has them (simplified).
function newMapModule() {
    class MapInterface {
        InitMapText() {
            this.textCalls++;
            if (this.initCompletionTimer)
                clearTimeout(this.initCompletionTimer);
            // the completion lists are rebuilt for the shown page in a setTimeout(0)
            const fill = () => {
                this.initCompletionTimer = 0;
                for (const [field, items] of Object.entries(this.game.lists))
                    this.W_MapItemCompletionUI[field] = tarray(items.filter((e) => this.allowed.includes(e.MapID)));
            };
            this.initCompletionTimer = setTimeout(this.slowLists ? () => { this.initCompletionTimer = setTimeout(fill, 0); } : fill, 0);
        }
        initAdvancedSlotWidget() {
            this.slotCalls++;
            for (const element of this.AdvancedSlots)
                this.RemoveWidget(element);
            this.AdvancedSlots.Empty();
            // the portal (the game's own advanced slot)
            const portal = this.CreateWidget("Portal", V(0, 0));
            portal.InitWidget("Portal", "huanshushiPortal_1");
            portal.slot.SetPosition(new Vector2D(1, 1));
            this.focusItemMap.set("huanshushiportal_1", { widget: portal, itemType: 3, mapID: "huanshushi" });
            this.AdvancedSlots.Add(portal);
        }
        getFocusCandidatesSorted() { return [...this.focusItemMap.keys()].map((key) => ({ key })); }
        iconCenterByID(id) { const v = this.focusItemMap.get(String(id).toLocaleLowerCase()); return v ? v.widget.slot.pos : undefined; }
        Tick() { this.ticks++; }
        switchMap() { this.switches++; }
        getallowedMapID() { return this.allowed.slice(); }
        ConvertWorldLocationToScreen(location) { return location.X === -1 ? new Vector2D(0, 0) : new Vector2D(location.X / 10, location.Y / 10); }
        applyRenderScale(widget, scale) { widget.renderScale = scale; }
        getElementZoomScale() { return 2; }
        IsOpenByBell() { return !!this.byBell; }
        isOpenCompletion() { return !!this.completionOpen; }
        UpdateMaskWidget() { this.maskUpdates++; }
    }
    const originals = {};
    for (const name of Object.getOwnPropertyNames(MapInterface.prototype))
        originals[name] = MapInterface.prototype[name];
    return { MapInterface, originals };
}
// The map class mixes: like Puerts' blueprint.mixin, a copy of MapInterface.prototype's methods at this moment.
function mix(mapModule) {
    const P = mapModule.MapInterface.prototype;
    const copy = {};
    for (const name of Object.getOwnPropertyNames(P))
        if (name !== "constructor" && typeof P[name] === "function")
            copy[name] = P[name];
    return copy;
}
function newWidget(game, cls, location) {
    game.created++;
    const w = { cls, location, visibility: VIS.SelfHitTestInvisible, valid: true, label: undefined, key: undefined };
    w.GetVisibility = () => w.visibility;
    w.SetVisibility = (v) => { w.visibility = v; };
    w.InitWidget = (label, key) => { w.label = label; w.key = key; };
    w.Image_29 = { scale: 1, color: undefined, brush: undefined };
    w.Image_29.SetRenderScale = (v) => { w.Image_29.scale = v.X; };
    w.Image_29.SetColorAndOpacity = (c) => { w.Image_29.color = [c.R, c.G, c.B].join(); };
    w.Image_29.SetBrushFromTexture = (t) => { w.Image_29.brush = t; };
    w.slot = { pos: undefined };
    w.slot.SetSize = (v) => { w.slot.size = [v.X, v.Y].join(); };
    w.slot.SetAlignment = (v) => { w.slot.align = [v.X, v.Y].join(); };
    w.slot.SetZOrder = (z) => { w.slot.z = z; };
    w.slot.SetPosition = (p) => { w.slot.pos = p; };
    w.slot.GetPosition = () => w.slot.pos;
    return w;
}
// A map widget of a mixed class (its methods: the copy taken at mix time).
function newMap(game, copy, fields = {}) {
    const map = Object.create(copy);
    const group = { widgets: [], selected: undefined };
    group.AddWidget = (w) => { group.widgets.push(w); };
    group.RemoveAll = () => { group.widgets = []; group.selected = undefined; };
    group.ClearSelection = () => { group.selected = undefined; };
    group.GetSelectedButtonBase = () => group.selected;
    Object.assign(map, {
        game, allowed: ["huanshushi", "meigu_yiji"], BigMapMode: false, valid: true, textCalls: 0, slotCalls: 0, ticks: 0, switches: 0,
        maskUpdates: 0, focusCalls: 0, initCompletionTimer: 0, pendingInitSlice: 0, cursorFocusedIconID: "", lastSnappedIconID: "",
        W_MapItemCompletionUI: { BP_MapItemDataAsset: game.asset }, AdvancedSlots: tarray([]), SlotWidgetGroup: group,
        focusItemMap: new Map(), Gadget: { children: [], AddChild(w) { this.children.push(w); } },
        IconSizeAdvancedSlot: new Vector2D(20, 20), IconSizeKey: new Vector2D(16, 16), IconSizePortal: new Vector2D(38, 38),
        AdvancedSlotClass_HeiShi: "HeiShi", AdvancedSlotClass_Hupo: "HuPo", AdvancedSlotClass_Flower: "Flower",
        AdvancedSlotClass_PrimaryItem: "PrimaryItem", AdvancedSlotClass_YaoshiItem: "YaoShi", AdvancedSlotClass_Challenge: "Challenge",
        MaskWidgetInstance: undefined, allValidMaskIDs: new Set(["Fog_A", "Fog_B", "Fog_C", "Fog_E"]),
        MapUnLockMasks: { Contains: () => false }, fadeWidgets: [], focused: false,
    }, fields);
    map.CreateWidget = (cls, location) => newWidget(game, cls, location);
    map.RemoveWidget = (w) => { game.removed++; w.pooled = true; };
    map.HasAnyUserFocus = () => map.focused;
    map.HasFocusedDescendants = () => false;
    map.SetIsFocusable = (v) => { map.focusable = v; };
    map.SetFocus = () => { map.focusCalls++; map.focused = true; };
    return map;
}

function boot(options = {}) {
    const game = options.game || newGame(options);
    const mapModule = options.mapModule || newMapModule();
    const w = { game, mapModule, now: 1000000, files: new Map(), saved: [], warnings: [], logs: [], pushed: [], loadError: undefined };
    for (const [file, text] of Object.entries(options.files || {})) {
        w.files.set(file, text);
    }
    const timers = options.timers || { next: 1, queue: new Map() };
    w.timers = timers;
    globalThis.setTimeout = (fn) => { const id = timers.next++; timers.queue.set(id, fn); return id; };
    globalThis.clearTimeout = (id) => { timers.queue.delete(id); };
    const gameInstance = { path: "/Engine/Transient.GameInstance" };
    const sub = (name) => ({ StaticClass: () => name });
    const ue = {
        KismetSystemLibrary: { IsValid: (o) => !!o && o.valid !== false, ConvertToAbsolutePath: (p) => p },
        BlueprintPathsLibrary: { FileExists: (p) => w.files.has(p) },
        EasyCsv: {
            LoadStringFromLocalFile(p, out) { out[0] = w.files.get(p); return true; },
            SaveStringToFileWithFullPath(text, p) { w.saved.push([p, text]); w.files.set(p, text); return true; },
        },
        ESlateVisibility: VIS,
        KismetTextLibrary: { Conv_TextToString: (t) => String(t) },
        KismetInternationalizationLibrary: { GetCurrentCulture: () => options.culture || "en" },
        PBZBackPackSubsystem: Object.assign(sub("PBZBackPackSubsystem"), {
            GetPropData: (id) => ({ ItemName: { Key: id + "_Name" } }),
            GetAccessoryData: (id) => ({ AccessoryName: { Key: "AName_" + id } }),
            GetMedicineData: (id) => ({ Name: { Key: "MName_" + id } }),
        }),
        PBZGameSystem: sub("PBZGameSystem"),
        BellManager: Object.assign(sub("BellManager"), { GetBellData: (id) => ({ BellName: { Key: id == "Bell_HSS_01" ? "BellName_1" : "" } }) }),
        PBZLevelActorManager: sub("PBZLevelActorManager"),
        EventPipelineManager: sub("EventPipelineManager"),
        MapSubsystem: sub("MapSubsystem"),
        PBZBlueprintFunctionLibrary: { MakeTextByKey: (key) => game.text(key) },
        Vector, Vector2D, LinearColor,
        WidgetLayoutLibrary: { SlotAsCanvasSlot: (widget) => widget.slot },
        WidgetBlueprintLibrary: { Handled: () => "Handled", Unhandled: () => "Unhandled" },
        KismetInputLibrary: { GetKey: (event) => ({ KeyName: event.key }), InputEvent_IsRepeat: (event) => !!event.repeat },
        Texture2D: { Load: (p) => ({ path: p, valid: true }) },
        Game: { PBZContent: { Blueprint: { Enum: { E_ChallengeType: { E_ChallengeType: { DaoCaoren: 0, LongZhu: 1, RongShuZhiXin: 2 } } } } } },
        Texture: sub("Texture"), MaterialInterface: sub("MaterialInterface"),
        KismetMathLibrary: { ClassIsChildOf: (a, b) => a === b },
        Color: "Color", NewArray: () => tarray([]), DrawToRenderTargetContext: class { },
        ETextureRenderTargetFormat: { RTF_RGBA8: 1 }, EBlendMode: { BLEND_Translucent: 2 },
        KismetRenderingLibrary: {
            CreateRenderTarget2D: (ctx, W, H) => { game.targets = (game.targets || 0) + 1; return { SizeX: W, SizeY: H, cells: [], valid: true }; },
            ClearRenderTarget2D: (ctx, rt) => { rt.cells = []; },
            BeginDrawCanvasToRenderTarget: (ctx, rt, canvasRef) => {
                canvasRef[0] = {
                    K2_DrawTexture: (tex, at, size) => { rt.cells.push({ x: at.X, y: at.Y, w: size.X, h: size.Y, tex }); },
                    K2_DrawMaterial: () => { throw new Error("no material drawing in this test"); },
                };
            },
            EndDrawCanvasToRenderTarget: () => { },
            ReadRenderTarget: (ctx, rt, outRef) => {
                if (options.pixelByPixel)
                    return false;
                const arr = tarray([]);
                for (let y = 0; y < rt.SizeY; y++)
                    for (let x = 0; x < rt.SizeX; x++)
                        arr.items.push(pixel(rt, x, y));
                outRef[0] = arr;
                return true;
            },
            ReadRenderTargetPixel: (ctx, rt, x, y) => { game.pixelReads = (game.pixelReads || 0) + 1; return pixel(rt, x, y); },
        },
    };
    function pixel(rt, x, y) {
        const c = rt.cells.find((cell) => x >= cell.x && x < cell.x + cell.w && y >= cell.y && y < cell.y + cell.h);
        const value = c ? c.tex.value((x - c.x) / c.w, (y - c.y) / c.h) : 0;
        return { R: value, G: 0, B: 0, A: 255 };
    }
    const cpp = { FText: { FromString: (s) => String(s), Format: (fmt, ...args) => args.reduce((t, a, i) => t.replace(`{${i}}`, String(a)), fmt) } };
    const puerts = {
        $ref: (value) => [value],
        $unref: (box) => box[0],
        argv: { getByName: (name) => (name == "GameInstance" && !options.noGameInstance ? gameInstance : undefined) },
    };
    const ts = { default: { getWorldSubsystem: (ctx, cls) => game.subsystems[cls], constructGameplayTag: (tag) => tag } };
    const uiHelper = { default: { GetTextByID: (key) => game.text(key) } };
    const stubs = { "ue": ue, "cpp": cpp, "puerts": puerts, "Library/TsHelper": ts, "Library/UIHelper": uiHelper, "UI/Widget/Map": mapModule };
    const load = Module._load;
    const hooked = function (request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(stubs, request)) {
            return stubs[request];
        }
        return load.call(this, request, parent, isMain);
    };
    const realNow = Date.now, realWarn = console.warn, realLog = console.log;
    const enter = () => {
        Module._load = hooked;
        Date.now = () => w.now;
        console.warn = (message) => w.warnings.push(String(message));
        console.log = (message) => w.logs.push(String(message));
    };
    const leave = () => {
        Module._load = load;
        Date.now = realNow;
        console.warn = realWarn;
        console.log = realLog;
    };
    globalThis.PBZModsMenu = options.menu === "array" ? [] : options.menu ? {
        api: { has: (f) => !(options.menuMissing || []).includes(f) },
        push(...mods) { w.pushed.push(...mods); return w.pushed.length; },
        settingsPath: (id) => (w.pushed.some((m) => m.id == id) ? MENU_PATH : undefined),
    } : undefined;
    w.menuGlobal = globalThis.PBZModsMenu;
    if (options.beforeLoad)
        options.beforeLoad(mapModule);
    delete require.cache[require.resolve(SCRIPT)];
    enter();
    try {
        w.exports = require(SCRIPT);
    }
    catch (e) {
        w.loadError = e;
    }
    finally {
        leave();
    }
    w.call = (fn) => {
        enter();
        try {
            return fn();
        }
        finally {
            leave();
        }
    };
    // the pending timers, in order (also the ones they start)
    w.flush = () => w.call(() => {
        for (let guard = 0; timers.queue.size && guard < 100; guard++) {
            const [id, fn] = timers.queue.entries().next().value;
            timers.queue.delete(id);
            fn();
        }
    });
    w.mix = () => mix(mapModule);
    w.newMap = (copy, fields) => newMap(game, copy || w.mix(), fields);
    // the game opens a region page (Map.js toCurrentMap / toOtherMapByID, the parts that matter here)
    w.open = (map, how = {}) => {
        w.call(() => {
            map.focusItemMap.clear();
            map.SlotWidgetGroup.RemoveAll();
            for (const x of map.AdvancedSlots)
                map.RemoveWidget(x);
            map.AdvancedSlots.Empty();
            map.BigMapMode = false;
            map.InitMapText();
            map.MaskWidgetInstance = how.lateFog ? undefined : game.mask;
            if (how.frameSplit)
                map.pendingInitSlice = 1;
            else
                map.initAdvancedSlotWidget();
        });
        w.flush();
    };
    w.frames = (map, count = 1) => {
        for (let i = 0; i < count; i++) {
            w.now += 16;
            w.call(() => map.Tick({}, 0.016));
        }
    };
    w.key = (map, key, repeat = false) => w.call(() => map.OnPreviewKeyDown({}, { key, repeat }));
    w.wait = (ms) => { w.now += ms; };
    w.stop = () => w.call(() => w.exports.stop());
    return w;
}
// the mod's icons on a map: the widgets in AdvancedSlots that are not the game's portal
const ours = (map) => map.AdvancedSlots.items.filter((x) => x.cls !== "Portal" && !x.pooled);
const shown = (map) => ours(map).filter((x) => x.visibility !== VIS.Collapsed);
const byKey = (map, key) => ours(map).find((x) => x.key === key);
const kinds = (list) => list.map((x) => x.cls).reduce((a, c) => { a[c] = (a[c] || 0) + 1; return a; }, {});
const materials = (list) => list.filter((x) => x.Image_29.color === MATERIAL_TINT);

// The module as PBZModLoader loads it.
{
    delete globalThis[SESSION_KEY];
    const w = boot();
    const P = w.mapModule.MapInterface.prototype;
    check("no error at load; stop() exported; no timer at load", !w.loadError && typeof w.exports.stop == "function" && w.timers.queue.size == 0);
    check("one start line for loader.log, naming the settings file in the mod's folder, 7 wraps and the 598 material spots",
        w.logs.length == 1 && w.logs[0] == `[PBZMOD] [Map Collectible Markers] ${VERSION} started; settings: ${SETTINGS_PATH}; 7 map methods wrapped; 598 material spots`);
    check("six MapInterface methods wrapped and OnPreviewKeyDown added (no game script replaced); the hook table is set",
        METHODS.every((m) => P[m] !== w.mapModule.originals[m]) && typeof P.OnPreviewKeyDown == "function"
        && typeof globalThis[HOOKS_KEY] == "object" && Object.keys(globalThis[HOOKS_KEY]).length == 7);
    check("no other method added to the map class (the game keeps the mixin's copy across Alt+F5)",
        Object.getOwnPropertyNames(P).filter((n) => !(n in w.mapModule.originals)).join() == "OnPreviewKeyDown");
    check("no Mods Menu: no page pushed anywhere", globalThis.PBZModsMenu === undefined && w.pushed.length == 0);
    const text = fs.readFileSync(SCRIPT, "utf8");
    check("no eval and no new Function in main.js (the game may block code from strings)", !/\beval\s*\(|new Function|Function\s*\(/.test(text.replace(/\/\/.*$/gm, "")));
    const regions = {};
    for (const s of SPOTS)
        regions[s[0]] = (regions[s[0]] || 0) + 1;
    check("the 598 material spots of the source mod, per region as its analysis lists them", SPOTS.length == 598
        && JSON.stringify(regions) == JSON.stringify({ HouJie: 106, FuJiZhiLin: 67, XiGu: 48, XiMeng: 70, LuJiaCun: 63, PangZhen: 53,
            ZhengDaoDaYing: 43, DengDingShanDao: 39, DuanHunYa: 17, MeiGuHu: 84, MeiGu_YiJi: 7, HuanShuShi: 1 }));
}

// A region page: the icons, their labels, the fog.
{
    delete globalThis[SESSION_KEY];
    const w = boot();
    const { game } = w;
    const map = w.newMap(); // the map class mixes after the mod started (the game test of World Map Outlines 1.0)
    w.open(map);
    const k = kinds(ours(map));
    check("the six game kinds as the map script would draw them: 1 Black Stone (one off the map), 1 Amber (one under fog), 1 Memory Flower, "
        + "2 Major Chests (one per chest), 1 key, 1 challenge (one under fog)", k.HeiShi == 1 && k.HuPo == 1 && k.Flower == 1 && k.YaoShi == 1
        && k.Challenge == 1 && ours(map).filter((x) => x.cls == "PrimaryItem" && /^primarydata/.test(x.key)).length == 2);
    const gear = ours(map).filter((x) => /^pbzgear/.test(x.key));
    check("gear: the unrung bell, the weapon not owned and the one owned only in an earlier playthrough, the accessory, and 7 material spots "
        + "(1 of HuanShuShi, 6 of MeiGu_YiJi: one is broken already); no rung or hidden bell, no owned weapon, none in a chest, none at 0,0,0",
        gear.length == 11 && materials(gear).length == 7 && gear.every((x) => x.cls == "PrimaryItem"));
    check("the keys are the map script's own (list index kept); the portal stays", ["Heishi0", "HuPo1", "Flower0", "primarydata0", "primarydata2",
        "meigu_yijiyaoshidata0", "huanshushichallengeType1"].every((key) => byKey(map, key)) && map.focusItemMap.has("huanshushiportal_1"));
    check("every icon: in AdvancedSlots, on the Gadget, in SlotWidgetGroup and in focusItemMap as a Lock item of its map",
        ours(map).every((x) => map.Gadget.children.includes(x) && map.SlotWidgetGroup.widgets.includes(x)
            && map.focusItemMap.get(x.key.toLocaleLowerCase()).widget === x && map.focusItemMap.get(x.key.toLocaleLowerCase()).itemType === 2));
    const hs = byKey(map, "Heishi0"), key = byKey(map, "meigu_yijiyaoshidata0"), ch = byKey(map, "huanshushichallengeType1");
    check("a Black Stone: centred, z-order 4, at its map position, render scale 1, its map ID, the picture 4.5 times bigger",
        hs.slot.align == "0.5,0.5" && hs.slot.z == 4 && hs.slot.pos.X == 1000 && hs.slot.pos.Y == 1000
        && hs.renderScale === 1 && hs.OwnMapID == "huanshushi" && hs.Image_29.scale == 4.5);
    check("drawn in the timer after the lists: every icon sized like the game's own on zoom (portal size x zoom)",
        ours(map).every((x) => x.slot.size == "76,76"));
    check("a key: z-order 11; a challenge: z-order 11 and its type", key.slot.z == 11 && ch.slot.z == 11 && ch.ChallengeType === 2);
    check("labels: the Black Stone names the boss (its map data's flow), the Amber says enemies", hs.label == 'Black Stone Fragment\nDefeat "Jian Chi" to get it'
        && byKey(map, "HuPo1").label == "Amber Fragment\nDefeat the enemies here");
    check("labels the game left empty get the source's words: Major Chest, Key, Human-Faced Banyan; the Ruins' key says it is inside them",
        byKey(map, "primarydata0").label == "Major Chest" && key.label == 'Key\nInside "Illusionist\'s Ruins" (a separate area, not on the surface)'
        && ch.label == "Human-Faced Banyan");
    check("Memory Flowers are blue", byKey(map, "Flower0").Image_29.color == "0.35,0.75,1");
    const label = (re) => gear.find((x) => re.test(x.label));
    check("gear labels: the bell's name, the weapon's name with its NPC, the accessory 'In a chest', a material spot its materials",
        !!label(/^Ruins Bell$/) && !!label(/^Sword One\nGiven by "Weaver" \(NPC quest\)$/) && !!label(/^Sword Three$/)
        && !!label(/^Jade Ring\nIn a chest$/) && materials(gear).some((x) => /^N:\w+ ×\d+/.test(x.label)));
    check("gear pictures: the Collection details picture of each kind, drawn 1.6 times bigger, tinted",
        gear.every((x) => x.Image_29.brush && /T_Map_CollectionProgress_/.test(x.Image_29.brush.path) && x.Image_29.scale == 1.6)
        && label(/^Ruins Bell$/).Image_29.color == "1,0.85,0.45");
    check("the Illusionist's Ruins' material spots say they are inside them", materials(gear).filter((x) => /Illusionist's Ruins/.test(x.label)).length == 6);
    check("fog: the icon under a fogged patch's picture is hidden (Amber 0), the one in the patch's corner outside its cloud shows (Flower), "
        + "a patch cleared in the save hides nothing (Black Stone), a collapsed patch nothing (key), a patch the game ignores nothing (chest 2), "
        + "a material patch's picture counts (challenge 0)", !byKey(map, "HuPo0") && !!byKey(map, "Flower0") && !!hs && !!key
        && !!byKey(map, "primarydata2") && !byKey(map, "huanshushichallengeType0"));
    check("a line for loader.log with the counts; no warning",
        w.logs.some((l) => l == "[PBZMOD] [Map Collectible Markers] region map huanshushi,meigu_yiji: HeiShi=1 HuPo=1 Flower=1 PrimaryItem=2 YaoShi=1 Challenge=1 Gear=11 off-map=1 fog=2/4")
        && w.warnings.length == 0);
    check("a missing settings file is written once with the defaults; the shipped file is exactly that text (CRLF)",
        w.saved.length == 1 && w.saved[0][0] == SETTINGS_PATH && w.saved[0][1] == fs.readFileSync(SETTINGS, "utf8")
        && fs.readFileSync(SETTINGS, "utf8").includes("\r\n"));
    const count = ours(map).length, created = game.created;
    w.open(map);
    check("the page built again (another region, or opened again): the game removes the old icons, the mod draws them once more, no doubles",
        ours(map).length == count && game.created == created + count + 1);
    w.call(() => map.initAdvancedSlotWidget());
    check("the game's own slot refresh: the icons again at once (the lists are fresh), with the game's slot sizes (the key's own)",
        ours(map).length == count && byKey(map, "Heishi0").slot.size == "20,20" && byKey(map, "meigu_yijiyaoshidata0").slot.size == "16,16");
    map.allowed = ["fujizhilin"];
    w.open(map);
    check("another region: only its own icons, none from the page before (its lists are rebuilt first)",
        ours(map).length > 0 && ours(map).every((x) => /^pbzgear/.test(x.key))
        && materials(ours(map)).length == SPOTS.filter((s) => s[0] == "FuJiZhiLin").length - 13);
}

// The first open's frame-split build, the lists late, the world map, the timer cancelled.
{
    delete globalThis[SESSION_KEY];
    const w = boot();
    const map = w.newMap();
    w.open(map, { frameSplit: true });
    check("first open with the frame-split build pending: nothing drawn in the timer", ours(map).length == 0);
    w.call(() => { map.pendingInitSlice = 0; map.initAdvancedSlotWidget(); });
    check("... the build's initAdvancedSlotWidget draws them", ours(map).length == 18);
    const slow = w.newMap(undefined, { slowLists: true });
    w.open(slow);
    check("the lists rebuilt one timer later: the mod waits for them", ours(slow).length == 18);
    const big = w.newMap();
    w.call(() => { big.InitMapText(); big.BigMapMode = true; big.initAdvancedSlotWidget(); });
    w.flush();
    check("the world map (BigMapMode): no icons", ours(big).length == 0);
    const quick = w.newMap();
    w.call(() => { quick.InitMapText(); quick.InitMapText(); quick.MaskWidgetInstance = w.game.mask; quick.initAdvancedSlotWidget(); });
    w.flush();
    check("InitMapText twice before the timers: drawn once", ours(quick).length == 18 && w.warnings.length == 0);
}

// The fog: pixel by pixel, without pictures, loaded late, off.
{
    delete globalThis[SESSION_KEY];
    const p = boot({ pixelByPixel: true });
    const map = p.newMap();
    p.open(map);
    check("the render target cannot be read at once: pixel by pixel, the same icons", ours(map).length == 18 && p.game.pixelReads > 0 && !byKey(map, "HuPo0"));
    const r = boot({ fogNoPictures: true });
    const m2 = r.newMap();
    r.open(m2);
    check("no fog pictures: the nearest patch decides (the Flower in the fogged patch's corner is hidden too)", !byKey(m2, "Flower0") && !byKey(m2, "HuPo0")
        && r.logs.some((l) => /fog=2\/4 \(rectangles\)/.test(l)));
    const l = boot();
    const m3 = l.newMap();
    l.open(m3, { lateFog: true });
    check("fog not loaded yet (a page opened from the world map): all drawn first", ours(m3).length == 20 && l.logs.some((x) => /fog=later/.test(x)));
    l.call(() => { m3.MaskWidgetInstance = l.game.mask; });
    l.frames(m3, 1);
    check("... the fog appears: one frame for its layout", shown(m3).length == 20);
    l.frames(m3, 1);
    check("... then the icons under it are hidden and left out of the pick", shown(m3).length == 18 && byKey(m3, "HuPo0").visibility == VIS.Collapsed
        && l.call(() => m3.iconCenterByID("HuPo0")) === undefined && !l.call(() => m3.getFocusCandidatesSorted()).some((c) => c.key == "hupo0"));
    const never = boot();
    const m4 = never.newMap();
    never.open(m4, { lateFog: true });
    never.wait(6000);
    never.frames(m4, 1);
    never.call(() => { m4.MaskWidgetInstance = never.game.mask; });
    never.frames(m4, 3);
    check("... a fog that never came within 5 s is not waited for any more", shown(m4).length == 20);
    const off = boot({ files: { [SETTINGS_PATH]: "HideUnderFog=Off\r\n" } });
    const m5 = off.newMap();
    off.open(m5);
    check("HideUnderFog=Off: the icons under fog are drawn too, the fog is not read", ours(m5).length == 20 && m5.maskUpdates == 0
        && off.logs.some((x) => /fog=off/.test(x)));
}

// The key: focus, hide and show, Tab.
{
    delete globalThis[SESSION_KEY];
    const w = boot();
    const map = w.newMap();
    w.open(map);
    w.frames(map, 10);
    check("the page has no focus at first: none taken in the first 250 ms", map.focusCalls == 0);
    w.frames(map, 10);
    check("... then it is taken once (focusable first)", map.focusCalls == 1 && map.focusable === true);
    w.frames(map, 30);
    check("... and not again while the page shows", map.focusCalls == 1);
    const all = ours(map).length;
    map.SlotWidgetGroup.selected = byKey(map, "Heishi0");
    map.cursorFocusedIconID = "Heishi0";
    check("H: handled, every mod icon collapsed", w.key(map, "H") == "Handled" && shown(map).length == 0);
    check("... left out of the pick (the portal stays), the selection and cursor on one of them dropped",
        w.call(() => map.getFocusCandidatesSorted()).map((c) => c.key).join() == "huanshushiportal_1"
        && w.call(() => map.iconCenterByID("Heishi0")) === undefined && w.call(() => map.iconCenterByID("huanshushiPortal_1")) !== undefined
        && map.SlotWidgetGroup.selected === undefined && map.cursorFocusedIconID === "");
    check("a held key (repeat): handled, nothing changes", w.key(map, "H", true) == "Handled" && shown(map).length == 0);
    w.open(map);
    check("the choice holds for the next page built", ours(map).length == all && shown(map).length == 0);
    w.key(map, "h");
    check("H again: shown with their own visibility, back in the pick", shown(map).length == all
        && shown(map).every((x) => x.visibility == VIS.SelfHitTestInvisible) && w.call(() => map.getFocusCandidatesSorted()).length == all + 1);
    check("Tab: handled, the world map once; a second within 250 ms dropped", w.key(map, "Tab") == "Handled" && map.switches == 1
        && (w.call(() => map.switchMap()), map.switches == 1));
    w.wait(300);
    w.call(() => map.switchMap());
    check("... later it switches again; another key is the game's", map.switches == 2 && w.key(map, "M") == "Unhandled");
    map.completionOpen = true;
    check("Tab with the Collection details panel open: the game's", w.key(map, "Tab") == "Unhandled");
    const bell = w.newMap(undefined, { byBell: true });
    w.open(bell);
    w.frames(bell, 30);
    check("the map opened at a bell: icons, but no focus taken", ours(bell).length == all && bell.focusCalls == 0);
    const busy = w.newMap(undefined, { focused: true });
    w.open(busy);
    w.frames(busy, 30);
    check("a page that has focus already: not taken again", busy.focusCalls == 0);
    w.files.set(SETTINGS_PATH, "ToggleKey=J\r\n");
    w.wait(2000);
    w.frames(map, 1);
    check("ToggleKey=J (live): J toggles, H is the game's", w.key(map, "H") == "Unhandled" && w.key(map, "J") == "Handled" && shown(map).length == 0);
    w.key(map, "J");
    w.files.set(SETTINGS_PATH, "ToggleKey=Off\r\n");
    w.wait(2000);
    const padOnly = w.newMap();
    w.open(padOnly);
    w.frames(padOnly, 30);
    check("1.1: ToggleKey=Off, ControllerKey as shipped (D-pad up): focus taken, H and J are the game's, D-pad up toggles",
        padOnly.focusCalls == 1 && w.key(padOnly, "J") == "Unhandled" && w.key(padOnly, "H") == "Unhandled"
        && w.key(padOnly, "Gamepad_DPad_Up") == "Handled" && shown(padOnly).length == 0 && (w.key(padOnly, "Gamepad_DPad_Up"), shown(padOnly).length == all));
    w.files.set(SETTINGS_PATH, "ToggleKey=Off\r\nControllerKey=Off\r\n");
    w.wait(2000);
    const fresh = w.newMap();
    w.open(fresh);
    w.frames(fresh, 30);
    check("ToggleKey=Off and ControllerKey=Off: no focus taken, J, H and D-pad up are the game's", fresh.focusCalls == 0
        && w.key(fresh, "J") == "Unhandled" && w.key(fresh, "H") == "Unhandled" && w.key(fresh, "Gamepad_DPad_Up") == "Unhandled"
        && shown(fresh).length == all);
    check("no warning", w.warnings.length == 0);
}

// 1.1: the controller button.
{
    delete globalThis[SESSION_KEY];
    const w = boot();
    const map = w.newMap();
    w.open(map);
    w.frames(map, 30);
    const all = ours(map).length;
    check("the default: D-pad up hides the icons, a held D-pad up changes nothing, D-pad up again shows them",
        w.key(map, "Gamepad_DPad_Up") == "Handled" && shown(map).length == 0 && w.key(map, "Gamepad_DPad_Up", true) == "Handled"
        && shown(map).length == 0 && w.key(map, "Gamepad_DPad_Up") == "Handled" && shown(map).length == all);
    check("... the log names the button that toggled", w.logs.some((l) => l.endsWith("icons hidden (Gamepad_DPad_Up)")));
    check("another controller button: the game's, and the log names it once", w.key(map, "Gamepad_FaceButton_Bottom") == "Unhandled"
        && w.key(map, "Gamepad_FaceButton_Bottom") == "Unhandled"
        && w.logs.filter((l) => l.endsWith("controller button on the map: Gamepad_FaceButton_Bottom")).length == 1
        && w.logs.filter((l) => l.endsWith("controller button on the map: Gamepad_DPad_Up")).length == 1);
    check("the keyboard key still works next to it", w.key(map, "H") == "Handled" && shown(map).length == 0 && (w.key(map, "H"), shown(map).length == all));
    check("the settings line names the button", w.logs.some((l) => l.endsWith("settings: Enable=On HideUnderFog=On ToggleKey=H ControllerKey=DPadUp")));
    for (const [value, button, name] of [["l3", "Gamepad_LeftThumbstick", "L3"], ["R3", "Gamepad_RightThumbstick", "R3"],
        ["DPadLeft", "Gamepad_DPad_Left", "DPadLeft"], ["Gamepad_FaceButton_Top", "Gamepad_FaceButton_Top", "gamepad_facebutton_top"]]) {
        w.files.set(SETTINGS_PATH, `ControllerKey=${value}\r\n`);
        w.wait(2000);
        w.frames(map, 1);
        check(`ControllerKey=${value} (live): ${button} toggles, D-pad up is the game's`, w.key(map, "Gamepad_DPad_Up") == "Unhandled"
            && w.key(map, button) == "Handled" && shown(map).length == 0 && (w.key(map, button), shown(map).length == all)
            && w.logs.some((l) => l.endsWith(`ControllerKey=${name}`)));
    }
    check("no warning", w.warnings.length == 0);
    w.files.set(SETTINGS_PATH, "ControllerKey=Triangle\r\n");
    w.wait(2000);
    w.frames(map, 1);
    check("an unknown ControllerKey: no button, one warning naming the choices", w.key(map, "Gamepad_DPad_Up") == "Unhandled"
        && w.warnings.length == 1 && /ControllerKey=triangle is not a controller button \(DPadUp/.test(w.warnings[0]));
    w.files.set(SETTINGS_PATH, "Enable=Off\r\n");
    w.wait(2000);
    w.frames(map, 1);
    check("Enable=Off: the button is the game's", w.key(map, "Gamepad_DPad_Up") == "Unhandled");
}

// Enable, live and at build time; the snowed-in Blood Forest spots.
{
    delete globalThis[SESSION_KEY];
    const w = boot();
    const map = w.newMap();
    w.open(map);
    const all = ours(map).length;
    w.files.set(SETTINGS_PATH, "Enable=Off\r\n");
    w.wait(2000);
    w.frames(map, 1);
    check("Enable=Off (live): every mod icon collapsed and out of the pick", shown(map).length == 0
        && w.call(() => map.getFocusCandidatesSorted()).length == 1);
    w.open(map);
    check("... the next page: none drawn, the game's own method still runs", ours(map).length == 0 && map.slotCalls == 2);
    w.files.set(SETTINGS_PATH, "Enable=On\r\n");
    w.wait(2000);
    w.frames(map, 1);
    w.flush();
    check("Enable=On (live): drawn after a timer", ours(map).length == all && shown(map).length == all);
    const forest = w.newMap(undefined, { allowed: ["fujizhilin"] });
    w.open(forest);
    const fjzl = SPOTS.filter((s) => s[0] == "FuJiZhiLin").length;
    check("Blood Forest without the snow: its 13 snowed-in material spots are left out", materials(ours(forest)).length == fjzl - 13);
    w.game.storyTag = true;
    w.open(forest);
    check("... in the snow (the story tag set): all of them", materials(ours(forest)).length == fjzl);
    w.call(() => { w.game.cycle = 2; });
    check("no warning", w.warnings.length == 0);
}

// stop(), and a second copy after it (PBZModLoader's reload), with the game keeping the first copy's methods.
{
    delete globalThis[SESSION_KEY];
    const game = newGame();
    const w = boot({ game });
    const copy = w.mix();
    const map = w.newMap(copy);
    w.open(map);
    const all = ours(map).length;
    w.frames(map, 20);
    w.stop();
    const P = w.mapModule.MapInterface.prototype;
    check("stop(): the game's own methods back on the class, OnPreviewKeyDown removed, the hook table gone, a line for loader.log",
        METHODS.every((m) => P[m] === w.mapModule.originals[m]) && !("OnPreviewKeyDown" in P) && globalThis[HOOKS_KEY] === undefined
        && w.logs[w.logs.length - 1] == "[PBZMOD] [Map Collectible Markers] stopped" && w.warnings.length == 0);
    check("... the mod's icons collapsed and out of the focus list; the portal stays", shown(map).length == 0
        && [...map.focusItemMap.keys()].join() == "huanshushiportal_1" && map.__mcm === undefined);
    const ticks = map.ticks;
    w.frames(map, 3);
    check("... the kept wrappers run the game's own methods only: Tick, no key, no icons", map.ticks == ticks + 3
        && w.key(map, "H") == "Unhandled" && (w.call(() => map.initAdvancedSlotWidget()), ours(map).length == 0));
    w.open(map);
    check("... a page built after the last stop(): only the game's portal", ours(map).length == 0 && map.focusItemMap.size == 1);
    // the reload while the page shows
    const again = boot({ game, mapModule: w.mapModule, timers: w.timers });
    w.call(() => map.InitMapText());
    w.flush();
    w.call(() => map.initAdvancedSlotWidget());
    check("a second copy (the reload): its wrappers reach the game through the first copy's kept methods",
        !again.loadError && ours(map).length == all);
    again.stop();
    const third = boot({ game, mapModule: w.mapModule, timers: w.timers });
    third.frames(map, 1);
    third.flush();
    check("Alt+F5 while the page shows: the next copy draws the icons again at the next frame", shown(map).length == all
        && third.logs.some((l) => /region map huanshushi,meigu_yiji/.test(l)));
    third.frames(map, 20);
    check("... its key works through the kept OnPreviewKeyDown", third.key(map, "H") == "Handled" && shown(map).length == 0);
    third.key(map, "H");
    const remixed = third.newMap(); // the class mixed again later: the third copy's own wrappers
    third.open(remixed);
    check("... a map class mixed after it uses its wrappers the same way", ours(remixed).length == all);
    third.stop();
    check("... and its stop() takes them off both maps", shown(map).length == 0 && shown(remixed).length == 0 && third.warnings.length == 0);
}

// Mods Menu: optional.
{
    delete globalThis[SESSION_KEY];
    const m = boot({ menu: true, files: { [MENU_PATH]: "HideUnderFog=Off\r\nToggleKey=K\r\n" } });
    const page = m.pushed[0];
    const keys = (text) => [...text.matchAll(/^(\w+)=/gm)].map((x) => x[1]).sort().join();
    check("Mods Menu running: one page with the mod's id, version, file, store \"saved\" and name",
        m.pushed.length == 1 && page.id == "phantombladezero_mapcollectiblemarkers" && page.version == VERSION
        && page.file == "phantombladezero_mapcollectiblemarkers.txt" && page.store == "saved" && page.title == "Map Collectible Markers");
    const key = page.settings.find((s) => s.key == "ToggleKey");
    check("... its rows are the shipped file's settings, with the same defaults; the key a choice with H and Off",
        page.settings.map((s) => s.key).sort().join() == keys(fs.readFileSync(SETTINGS, "utf8"))
        && page.settings.find((s) => s.key == "Enable").default === true && page.settings.find((s) => s.key == "HideUnderFog").default === true
        && key.type == "choice" && key.default == "H" && key.options.some((o) => o.value == "H") && key.options.some((o) => o.value == "Off"));
    const pad = page.settings.find((s) => s.key == "ControllerKey");
    check("... 1.1: the controller button a choice, D-pad up by default, the six buttons and Off", pad.type == "choice" && pad.default == "DPadUp"
        && pad.options.map((o) => o.value).join() == "DPadUp,DPadDown,DPadLeft,DPadRight,L3,R3,Off");
    const map = m.newMap();
    m.open(map);
    m.frames(map, 20);
    check("... the mod reads the file the page saves (HideUnderFog=Off, ToggleKey=K there)",
        m.logs[0].includes(`settings: ${MENU_PATH} (Mods Menu's page)`) && ours(map).length == 20 && m.key(map, "K") == "Handled");
    page.onChange();
    check("... a change on the page is read at the next frame", m.logs.filter((l) => /settings: Enable/.test(l)).length == 1
        && (m.frames(map, 1), true));
    const a = boot({ menu: "array" });
    check("Mods Menu not started yet (a plain array): nothing pushed, the mod's own file", a.menuGlobal.length == 0
        && a.logs[0].includes(`settings: ${SETTINGS_PATH};`));
    const o = boot({ menu: true, menuMissing: ["store.saved"] });
    check("an older Mods Menu without store \"saved\": no page", o.pushed.length == 0);
    o.stop(); // the real loader runs one copy at a time
}

// A failed start, and a map class whose key method another mod has locked.
{
    delete globalThis[SESSION_KEY];
    const n = boot({ noGameInstance: true });
    check("no GameInstance: the load throws (PBZModLoader logs the mod as failed), nothing wrapped",
        !!n.loadError && METHODS.every((m) => n.mapModule.MapInterface.prototype[m] === n.mapModule.originals[m]) && globalThis[HOOKS_KEY] === undefined);
    const b = boot({ beforeLoad: (mm) => { delete mm.MapInterface.prototype.iconCenterByID; } });
    check("a game build without a wrapped method: the load throws naming it, nothing left wrapped", !!b.loadError
        && /MapInterface\.iconCenterByID/.test(String(b.loadError)) && b.mapModule.MapInterface.prototype.InitMapText === b.mapModule.originals.InitMapText);
    const c = boot({ beforeLoad: (mm) => { delete mm.MapInterface.prototype.getElementZoomScale; } });
    check("a game build without a map function the mod calls: the load throws naming it", !!c.loadError && /getElementZoomScale/.test(String(c.loadError)));
    const locked = boot({ beforeLoad: (mm) => { Object.defineProperty(mm.MapInterface.prototype, "OnPreviewKeyDown", { value: () => "theirs", writable: false, configurable: true }); } });
    const map = locked.newMap();
    locked.open(map);
    locked.frames(map, 30);
    check("OnPreviewKeyDown locked by another mod: started anyway (one warning), the icons drawn, no focus taken",
        !locked.loadError && ours(map).length == 18 && map.focusCalls == 0 && locked.warnings.length == 1
        && /hide\/show key is off/.test(locked.warnings[0]) && locked.call(() => map.OnPreviewKeyDown({}, { key: "H" })) == "theirs");
    locked.stop();
    delete globalThis[SESSION_KEY];
}

process.exit(failed ? 1 : 0);
