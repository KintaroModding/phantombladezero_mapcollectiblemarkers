"use strict";
// Map Collectible Markers for Phantom Blade Zero: a PBZModLoader mod (ProjectPBZ/PBZModLoader/mods/phantombladezero_mapcollectiblemarkers/).
//
// The region map shows the collectibles you have not picked up yet: Black Stone and Amber fragments, Memory Flowers
// (blue), Major Chests (one icon per chest), keys and challenges with the game's own icons, which its map script has but
// never draws; and, with the pictures of the game's "Collection details" panel, bells not rung yet, weapons, shadow
// weapons, accessories, medicines and about 600 upgrade-material spots. Each icon's hover label names the item and how
// you get it (the boss, NPC or enemies, a chest, a story event...). Icons in areas still under fog stay hidden
// (HideUnderFog), and ToggleKey (H) or ControllerKey (D-pad up) on the region map hides or shows them until the game is
// closed.
//
// The game's map script (UI/Widget/Map.js) exports MapInterface, the mixin of the map widget WB_MapNew_C. Its
// initAdvancedSlot_HeiShi / HuPo / Flower / PrimaryItem / YaoShi / Challenge would draw six of these kinds from the lists
// of W_MapItemCompletionUI (still missing on the shown map), but their calls are commented out. The mod wraps seven
// MapInterface methods in memory:
// - InitMapText: the map rebuilds those lists in a setTimeout(0); the mod draws its icons after that timer, but not while
//   the first open's frame-split build is pending (that build calls initAdvancedSlotWidget, which draws them).
// - initAdvancedSlotWidget: after the game's own slots (it removes all of AdvancedSlots, the mod's icons too), the mod
//   places its icons the way those functions place theirs (the map's CreateWidget pool, InitWidget, SlotWidgetGroup,
//   focusItemMap, Gadget, AdvancedSlots and the canvas slot), each picture SCALE times bigger than its slot. It copies
//   no game function and evaluates no code.
// - getFocusCandidatesSorted and iconCenterByID: hidden icons (the keys, Enable=Off, found under fog later) are left
//   out of the hover and gamepad pick.
// - Tick: the settings (at most every 2 s), keyboard focus for the map page a moment after it shows (the page never
//   takes it, so its key events would never fire), and the fog check again once a region's fog has loaded.
// - OnPreviewKeyDown (the map script has none; the mod adds it): ToggleKey and ControllerKey (Slate hands controller
//   buttons to the focused widget as key events too; 1.1 names each controller button it sees once in the log), and
//   Tab, which Slate takes as "next widget" while the page has focus, so the mod switches to the world map itself.
// - switchMap: while the mod's key is on, a second switch within 250 ms is dropped (the game's Tab binding may fire too).
// The fog check reads the fog patches still there (MapSubsystem.GetUnLockMaskIDs and the map's mask widget) and draws
// their pictures into a small render target, so an icon is hidden where fog is actually drawn over it.
// Puerts' blueprint.mixin copies the prototype's methods when the map class mixes, and the game keeps those copies
// across Alt+F5. So every wrapper looks up its replacement in globalThis[HOOKS_KEY] at call time, which the running copy
// fills at start and stop() deletes, and the mod adds no other method to the class. stop() also collapses the mod's
// icons and takes them out of the map's focus list (the map's next rebuild removes them). Nothing is written into the
// save.
//
// Ported from the author's earlier pak mod "Map Collectible Markers" 1.3.4 (Fog version), a block appended to the game
// script UI/Widget/Foundation/BoundActionBarReveal.js; the data below (MATERIAL_SPOTS, SOURCE_WHO and the rest) is that
// mod's.
// 1.1: ControllerKey, a controller button for hide and show (D-pad up by default).
//
// PBZModLoader loads this file after the game's MainStart, through the game's module system: "ue", "cpp", "puerts",
// "Library/TsHelper", "Library/UIHelper" and "UI/Widget/Map" are the game's modules. Before a reload (Alt+F5) it awaits
// stop(). Settings: phantombladezero_mapcollectiblemarkers.txt next to this file (__dirname), "Key=Value" lines (; or #
// starts a comment, the first line of a key wins), read at most every SETTINGS_MS while the region map shows, and
// written with the defaults when missing. With Mods Menu (0.9.0 or later) running, the mod adds its page there and reads
// the file that page saves instead (a page cannot save anywhere else).
const UE = require("ue");
const cpp = require("cpp");
const puerts = require("puerts");
const Ts = require("Library/TsHelper").default;
const UIHelper = require("Library/UIHelper").default;

const MOD_NAME = "Map Collectible Markers";
const MOD_ID = "phantombladezero_mapcollectiblemarkers"; // the mod folder's name and Mods Menu's page id
const MOD_VERSION = "1.1";
const SETTINGS_MS = 2000;
const SETTINGS_FILE = MOD_ID + ".txt";
const TRACE_LINES = 200;
// Every setting with its default; the shipped settings file holds exactly this text (tests/test_mod.js checks it).
const DEFAULT_TEXT = ["; " + MOD_NAME + " settings. Change a value and save; the region map takes it within 2 seconds.",
    "; Enable: On, or Off (the game's own map: the mod's icons go away).",
    "; HideUnderFog: On (no icons in areas still under fog, until you ring the bell that clears it), or Off (all icons).",
    ";   It takes effect the next time the map draws a region (open the map again).",
    "; ToggleKey: the key that hides or shows the icons on the region map (for example H, J, K, L, N, U, Y, F6 to F9),",
    ";   or Off (no key; the map's keys stay the game's own).",
    "; ControllerKey: the controller button that does the same: DPadUp, DPadDown, DPadLeft, DPadRight, L3 or R3 (a stick",
    ";   pressed in), or Off. On the region map that button then does only this.",
    "Enable=On", "HideUnderFog=On", "ToggleKey=H", "ControllerKey=DPadUp", ""].join("\r\n");
const KEY_CHOICES = ["H", "J", "K", "L", "N", "U", "Y", "F6", "F7", "F8", "F9", "Off"];
// ControllerKey's names -> the engine's key names (FKey)
const PAD_KEYS = { DPadUp: "Gamepad_DPad_Up", DPadDown: "Gamepad_DPad_Down", DPadLeft: "Gamepad_DPad_Left",
    DPadRight: "Gamepad_DPad_Right", L3: "Gamepad_LeftThumbstick", R3: "Gamepad_RightThumbstick" };

// ---- The source mod's values ---------------------------------------------------------------------------------------

const SCALE = 4.5; // the icon's picture vs its slot: the pictures have wide transparent margins, and on zoom the game
// sizes the slot like a portal's (38.67), which leaves a dot. The slot (hit area, spacing) stays the game's.
const FLOWER_TINT = [0.35, 0.75, 1.0];
// Bells not rung yet, weapons, shadow weapons, accessories and medicines: the game's map data has them (they count toward
// the map completion %), but the map draws only rung bells and none of the rest. They get the picture the game's
// "Collection details" panel uses for their kind, tinted, with the bell's or item's name as label, and go away once rung
// or owned in this playthrough. (An unrung bell is only a marker: the real bell icons teleport to the bell when clicked.)
const PIC = "/Game/PBZContent/UI/InGame/Map/T_Map_CollectionProgress_";
const GEAR = [
    // kind, list in the map data, id field, owned-items map on the backpack, tint, picture
    ["Bell", "BellDatas", "BellID", "", [1.0, 0.85, 0.45], PIC + "Bell.T_Map_CollectionProgress_Bell"],
    ["Weapon", "WeaponItemDatas", "WeaponID", "MainWeaponInfos", [1.0, 0.72, 0.25], PIC + "WeaponGear.T_Map_CollectionProgress_WeaponGear"],
    ["ShaChi", "ShaChiWeaponItemDatas", "WeaponID", "ShaqiWeaponInfos", [1.0, 0.32, 0.28], PIC + "WeaponGear.T_Map_CollectionProgress_WeaponGear"],
    ["Accessory", "AccessoryItemDatas", "AccessoryID", "Accessories", [0.45, 1.0, 0.5], PIC + "Accessory_Potion.T_Map_CollectionProgress_Accessory_Potion"],
    ["Medicine", "MedicineItemDatas", "MedicineID", "MedicineInfos", [0.85, 0.55, 1.0], PIC + "Accessory_Potion.T_Map_CollectionProgress_Accessory_Potion"],
];
const GEAR_PIC_SCALE = 1.6; // these pictures fill their square, unlike the map's own icon art
const GEAR_LABELS = {
    hant: { Bell: "鈴鐺", Weapon: "武器", ShaChi: "殺氣武器", Accessory: "飾品", Medicine: "藥品", Material: "鑄魂材料" },
    hans: { Bell: "铃铛", Weapon: "武器", ShaChi: "杀气武器", Accessory: "饰品", Medicine: "药品", Material: "铸魂材料" },
    en: { Bell: "Bell", Weapon: "Weapon", ShaChi: "Shadow Weapon", Accessory: "Accessory", Medicine: "Medicine", Material: "Upgrade material" },
};
const GEAR_SAME_SPOT = 200; // an item this close to a Major Chest icon is inside that chest
const HIDDEN_BELL = "bell_dp_002"; // a bell the map script never draws
// Upgrade materials (Weapon_Material_*, Ac_Material_*, Medi_Material_*) lying in breakable pots, small chests and
// hanging gifts. The game has no map data for them: the source mod read these spots out of the level files of Steam build
// 26266538 (the map script is the same in build 26367565). Each spot: [map ID, save key of the actor, X, Y, Z,
// "ItemID:amount|...", "c" chest / "b" breakable]. A spot is done once its actor has save data (broken or opened), the
// check the game itself uses for the chests of its map data.
const MATERIAL_SPOTS = [
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747158484",-255087,127576,-4110,"Weapon_Material_08:2","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA96AC02_1441440074",-73338,188700,-4203,"Weapon_Material_13:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C6B202_1494196455",-254793,79087,-5717,"Weapon_Material_26:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747181493",-251209,78961,-4197,"Weapon_Material_02:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747260524",-252584,82963,-6529,"Weapon_Material_08:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_00FF6172C59CBC4502_1709139723",-101388,157040,55,"Weapon_Material_13:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747124471",-239721,117561,-3684,"Weapon_Material_05:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990913B302_1319328937",-272019,88901,-7985,"Weapon_Material_05:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990982B302_1559276516",-217128,133838,-3499,"Weapon_Material_02:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C0B202_1948968349",-215776,133744,-4083,"Weapon_Material_25:6","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909589302_1196345333",-37480,270995,-26467,"Weapon_Material_22:1","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD6C0003_1664721917",-177444,82915,8156,"Weapon_Material_15:8","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD720003_1470245078",-210875,85095,7060,"Weapon_Material_27:9","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD720003_1835799081",-209330,83640,6960,"Weapon_Material_03:5","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD1F0003_2104082637",-227908,61690,14921,"Medi_Material_2:1","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD35B802_1393077667",-230197,63137,14857,"Weapon_Material_17:10","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF848099091CBE02_1595956824",-48958,267221,-25784,"Ac_Material_1:1","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDE6F202_1424971904",-51157,127789,-1296,"Weapon_Material_08:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDE9AC02_1254552260",-50528,122511,-2659,"Weapon_Material_07:12","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD300A03_1681219278",-199363,89992,4410,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990991FD02_1442291263",-213108,119974,-1784,"Weapon_Material_17:6","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA5F0C03_1284574302",-67513,180478,-1678,"Weapon_Material_04:9","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C3B202_1720689916",-252378,96896,-3544,"Weapon_Material_08:3","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA58F102_1239283512",-180011,128753,-6147,"Weapon_Material_09:3","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA58F102_1318964513",-180192,128696,-5737,"Weapon_Material_08:15","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6CB302_1986977579",-180958,132724,-6478,"Weapon_Material_19:8","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6CB302_2003749581",-185382,129890,-6589,"Weapon_Material_19:8","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1396097788",-179793,132929,-6477,"Weapon_Material_26:4","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA86FA02_1674412123",-69526,155390,-583,"Weapon_Material_13:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990916B302_1437946539",-264612,55961,-6514,"Weapon_Material_26:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF848099091EB302_1150703957",-261351,100669,-5326,"Weapon_Material_08:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDC7FF02_1351837185",-39873,107220,683,"Weapon_Material_25:9","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF848099091DBE02_1350932005",-26222,286239,-26578,"Weapon_Material_01:2","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD6A0003_1726638550",-203226,72720,8800,"Medi_Material_2:1","b"],
["HouJie","PBZ_Houjie_WP-BP_HangingGift_C_UAID_E89C25A7512647AF02_1743690168",-246425,107109,-3837,"Weapon_Material_14:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C3B202_1591042913",-247275,106670,-2864,"Weapon_Material_11:5","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD9AE702_1650080362",-52294,102084,-1636,"Weapon_Material_25:9","c"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1730545476",-219852,130414,-4039,"Weapon_Material_05:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD220003_2040244211",-220985,68237,14294,"Weapon_Material_15:8","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA77B302_1480525594",-176472,134797,-6054,"Weapon_Material_20:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747204502",-262357,81186,-4985,"Weapon_Material_02:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990983E302_1585396331",-236926,110643,-2629,"Medi_Material_1:2","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD6F0003_1783616531",-187074,86260,4325,"Weapon_Material_03:7","c"],
["XiGu","PBZ_Xigu_WP-BP_Chest_C_UAID_60CF84809909D09202_1423584423",-61110,221213,-18183,"Weapon_Material_04:4|Weapon_Material_07:2","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_74563CC57EE2F73B02_1315008654",-79606,173391,48,"Weapon_Material_10:8","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF848099099D0103_1550077544",-261795,112497,-7226,"Weapon_Material_02:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA890403_1361459195",-56734,144657,1110,"Weapon_Material_25:12","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA890403_1403840196",-56550,144516,1092,"Weapon_Material_16:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C5B202_1144328271",-242392,101578,-1047,"Weapon_Material_08:2","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA859302_1700529659",5203,157952,-925,"Ac_Material_1:1","b"],
["XiGu","PBZ_Xigu_WP-BP_HangingGift_C_UAID_60CF848099096BA802_1630202924",-58206,236524,-20297,"Weapon_Material_07:2|Weapon_Material_22:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747149481",-267190,73769,-6400,"Weapon_Material_08:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747209504",-265011,70575,-6425,"Weapon_Material_23:3","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD7B9202_1518243903",-52760,126328,-1160,"Weapon_Material_01:14","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDE6F202_1343715866",-52171,126428,-1185,"Weapon_Material_17:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C6B202_1296532453",-270825,79808,-7926,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1730477474",-269777,77905,-7958,"Weapon_Material_16:8","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909DCED02_1226562593",-55571,220952,-22193,"Weapon_Material_19:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Chest_C_UAID_60CF84809909C29202_1950278954",-36550,269245,-26294,"Weapon_Material_04:6|Weapon_Material_07:2|Weapon_Material_13:2","c"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA68FC02_1423811969",-166651,114141,-1681,"Weapon_Material_07:10","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C2B202_1146337722",-231399,108212,113,"Weapon_Material_05:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990978FF02_1093308931",-260980,97157,-2384,"Weapon_Material_14:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990978FF02_1127636932",-259960,98494,-2094,"Weapon_Material_01:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909B0F002_1716633000",-259061,98749,-5578,"Ac_Material_1:1","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA81FA02_1849706228",-107688,184121,-1238,"Weapon_Material_10:7","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747178492",-215682,119331,-1927,"Weapon_Material_02:4","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD3BF302_1482682555",-45753,106612,897,"Weapon_Material_02:2","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD40B802_1968052641",-195134,77342,6568,"Weapon_Material_18:10","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD700003_1093887708",-194261,82818,4525,"Weapon_Material_09:5","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD700003_1164555709",-192932,82255,4525,"Weapon_Material_20:8","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909B4AE02_1991654799",-39624,267104,-25121,"Weapon_Material_10:4","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD660003_1465306822",-205872,65049,10285,"Weapon_Material_26:7","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990983B302_1210404701",-254117,72271,-4907,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747206503",-250733,71665,-4391,"Weapon_Material_10:8","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909C39202_1312936131",-73279,184128,-17185,"Weapon_Material_13:1","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF8480990918BE02_1890512138",-70881,234035,-17380,"Weapon_Material_13:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747117468",-214074,124554,-3447,"Ac_Material_1:1","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA5F0C03_1353251303",-111588,178250,-371,"Weapon_Material_04:11","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA96AC02_1410039063",-112846,174699,-1263,"Weapon_Material_22:8","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_00FF6172C59CBD4502_2074733032",-92862,169427,-993,"Weapon_Material_10:8","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA96AC02_1405706061",-114764,160584,43,"Weapon_Material_01:8","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909C19202_2128889765",-74070,213688,-19470,"Weapon_Material_07:4","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF848099091BBE02_1657091643",-49234,223394,-20179,"Weapon_Material_16:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD6E9202_1847641602",-39491,123279,-3069,"Weapon_Material_26:2","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA71D602_1835889406",-44132,179377,3318,"Weapon_Material_18:9","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA71D602_1835892407",-42473,180332,6007,"Weapon_Material_12:19","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA9AFE02_2121768956",-43431,181324,2157,"Weapon_Material_27:15","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA9AFE02_2125837957",-43267,180527,-1378,"Weapon_Material_03:15","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990983B302_1152293700",-263811,77010,-6790,"Weapon_Material_05:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD740003_1995371452",-211610,110197,3838,"Ac_Material_1:1","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD750003_1142622629",-211671,109116,3820,"Weapon_Material_21:7","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA68FC02_1450156974",-183792,114201,-2853,"Weapon_Material_08:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Chest_C_UAID_E89C25A7512647AF02_1737578879",-212944,128235,-3938,"Weapon_Material_13:3|Weapon_Material_25:3","c"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747036436",-209453,124011,-3843,"Weapon_Material_02:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990914B302_2055548115",-259619,115468,-5690,"Weapon_Material_08:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Chest_C_UAID_60CF84809909759202_1930248360",-28167,283501,-22681,"Weapon_Material_01:2|Weapon_Material_04:4","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD6C0003_1862821918",-180864,84479,7294,"Medi_Material_2:1|Weapon_Material_12:7","c"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1441386794",-170838,120423,-4102,"Ac_Material_1:1","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_00FF6172C59CBB4502_2028608541",-95596,190699,-158,"Weapon_Material_07:8","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA7F9302_1112402971",-95774,186933,10,"Weapon_Material_01:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C1B202_2070119535",-228479,107923,447,"Weapon_Material_20:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C0B202_1733921346",-209544,131961,-4162,"Weapon_Material_08:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990916B302_1294642468",-263295,58670,-5261,"Weapon_Material_20:4","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD760003_1166666813",-211485,99620,5105,"Medi_Material_3:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909BB9202_1473550658",-614,291412,-29202,"Weapon_Material_10:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_00FF6172C59CBB4502_2079789542",110,161944,-1029,"Ac_Material_4:1","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CAD1FF02_1219394686",35,165005,-1256,"Ac_Material_1:1","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_74563CC57EE2F73B02_1307857258",2568,164466,-1019,"Ac_Material_1:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C6B202_1817453487",-248157,68716,-4917,"Weapon_Material_08:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDD4F402_1192846326",-63751,89638,-5595,"Weapon_Material_17:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909BF9202_1546921372",-26884,261439,-23724,"Weapon_Material_04:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1746007271",-203346,131546,-5469,"Weapon_Material_14:3","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDD4F402_1519494364",-67752,99894,-5035,"Weapon_Material_26:2","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD730003_1514347263",-224980,90729,7145,"Weapon_Material_21:7","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD730003_1875792266",-225837,95005,7150,"Weapon_Material_06:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1746005270",-224760,134797,-2855,"Weapon_Material_08:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747112466",-260410,104751,-4698,"Weapon_Material_13:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747147480",-276319,52990,-5629,"Weapon_Material_02:4","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909C29202_1640226950",-34142,266470,-25691,"Weapon_Material_10:3","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD0AF502_2085096149",-67352,103502,-5923,"Weapon_Material_23:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD94D002_1810542421",-50056,114057,-1640,"Weapon_Material_13:8","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909C29202_1349313945",-59149,215354,-13367,"Weapon_Material_01:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909C09202_1148963553",-65887,259880,-21892,"Weapon_Material_01:2","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD690003_1263190356",-207154,57476,10695,"Weapon_Material_21:7","b"],
["XiGu","PBZ_Xigu_WP-BP_HangingGift_C_UAID_60CF84809909A1AB02_1419703457",-60757,221041,-17529,"Weapon_Material_19:2|Weapon_Material_22:2","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA5BF102_1539394077",-80077,180365,-2165,"Weapon_Material_01:20|Weapon_Material_04:20|Weapon_Material_08:12","c"],
["XiGu","PBZ_Xigu_WP-BP_HangingGift_C_UAID_60CF84809909EEB502_1204757364",-69875,232730,-17422,"Weapon_Material_04:2|Weapon_Material_22:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD41F302_1608646832",-53472,112561,-1049,"Weapon_Material_22:8","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDEDF202_1783556211",-51475,113295,-1659,"Weapon_Material_22:8","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD7A9202_1824826715",-53644,100428,-1516,"Weapon_Material_10:12","b"],
["XiGu","PBZ_Xigu_WP-BP_Chest_C_UAID_60CF84809909C09202_1364548558",-58628,254422,-24209,"Weapon_Material_01:3|Weapon_Material_07:2","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA83FA02_1396752585",-124587,167095,-2516,"Ac_Material_1:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA68FC02_1402583968",-186524,116690,-3983,"Weapon_Material_23:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1308857765",-185782,117699,-3887,"Weapon_Material_05:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1873768820",-191285,120834,-4057,"Weapon_Material_17:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CAA5EC02_1877770777",-190488,118622,-4524,"Weapon_Material_02:7","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF8480990911BE02_1972668874",-74521,182273,-14440,"Weapon_Material_10:3","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD7A9202_1695445713",-48579,101292,1079,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C3B202_1213007902",-243742,116883,-3608,"Weapon_Material_08:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD36B802_1384103847",-228333,65872,14465,"Weapon_Material_03:5","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF848099091CBE02_1728460825",-56498,209881,-16981,"Weapon_Material_07:3","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909C09202_1223939554",-69253,253946,-21499,"Weapon_Material_01:4","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909549302_1800287600",-57571,219921,-19239,"Weapon_Material_13:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747212505",-259150,66517,-6102,"Weapon_Material_02:4","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA54D002_1388532995",-32741,150698,502,"Weapon_Material_01:6|Weapon_Material_04:5|Weapon_Material_10:6","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD789202_1870987879",-54642,132408,-371,"Weapon_Material_02:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDE3F202_2094900318",-56624,132399,-253,"Weapon_Material_14:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_A_C_UAID_E89C25A7512642AF02_1940972510",-249447,98457,-4422,"Weapon_Material_04:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF848099091BB302_1194528424",-244432,97263,-4026,"Weapon_Material_25:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747089457",-244038,97710,-4145,"Weapon_Material_05:4","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD6D0003_1353840099",-180765,89730,7170,"Medi_Material_2:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990982B302_1987454522",-225962,110443,1012,"Weapon_Material_02:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C1B202_2055225534",-224436,111925,432,"Weapon_Material_10:8","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C1B202_2093812536",-226827,111168,1025,"Weapon_Material_22:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C1B202_2103389537",-226870,112367,1146,"Weapon_Material_16:8","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909BB9202_1881844662",-9022,284972,-28985,"Weapon_Material_01:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD680603_2098489819",-66038,113730,-2006,"Weapon_Material_08:12","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD789202_1682716878",-66771,114155,-1989,"Weapon_Material_03:12","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD36B802_2113858852",-222245,71925,15414,"Weapon_Material_12:4","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD39B802_1235768383",-222037,73741,10371,"Weapon_Material_21:7","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD7DCE02_1771669810",-221670,73664,15369,"Weapon_Material_26:7","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747201501",-261300,90008,-4801,"Weapon_Material_11:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990983B302_1426664706",-248809,71221,-4846,"Weapon_Material_11:5","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD34F302_2111787759",-49257,105793,437,"Weapon_Material_25:9","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD710003_2000219900",-214108,74728,7280,"Medi_Material_2:1","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA859302_1830928660",-42263,148779,1606,"Weapon_Material_07:8","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909CDBD02_1576097271",-13457,293762,-28614,"Weapon_Material_19:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909569302_1460814968",-73773,226845,-18893,"Weapon_Material_10:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C6B202_1480857454",-268012,69133,-6880,"Weapon_Material_05:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD740003_1368236445",-224359,99321,5655,"Weapon_Material_24:12","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD740003_1486194447",-224140,99140,5640,"Weapon_Material_18:10","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_00FF6172C59CBE4502_1183773211",-28807,176234,627,"Weapon_Material_01:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990991FD02_1520156264",-201051,129252,-7979,"Weapon_Material_02:2","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD750003_1366716630",-208353,107032,3525,"Ac_Material_4:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747199500",-264693,85062,-5378,"Weapon_Material_08:3","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909C29202_1204510943",-52503,269707,-24268,"Weapon_Material_01:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C5B202_1211747272",-250842,94604,-3024,"Weapon_Material_02:4","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD680003_1671942176",-205977,60279,10150,"Weapon_Material_21:7","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDE8AC02_1770205073",-45720,115625,-2908,"Weapon_Material_04:13","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747237515",-272063,99382,-9599,"Weapon_Material_05:4","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD730003_2115473268",-214917,107706,4956,"Weapon_Material_24:13","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990919B302_2016902070",-245982,112949,-3290,"Weapon_Material_26:4","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA96AC02_1101634054",-21120,194268,-1223,"Weapon_Material_22:6","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDEAAC02_1877383572",-52499,100270,160,"Weapon_Material_20:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD799202_1880727520",-49719,132069,-1660,"Weapon_Material_23:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF848099095BFB02_1578006800",-261807,50196,-4765,"Weapon_Material_02:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA96AC02_1395748056",-76471,156685,-1009,"Weapon_Material_10:8","b"],
["XiGu","PBZ_Xigu_WP-BP_Chest_C_UAID_60CF8480990970D902_2108830455",-68575,224944,-18613,"Weapon_Material_01:3|Weapon_Material_04:4|Weapon_Material_13:2","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA819B02_1615150402",-54011,154514,-1481,"Weapon_Material_19:6","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CAD18D02_1999446134",-56760,153866,-1311,"Weapon_Material_07:6","b"],
["XiGu","PBZ_Xigu_WP-BP_HangingGift_C_UAID_60CF84809909A1AB02_1626374458",-65214,220587,-16604,"Weapon_Material_07:2|Weapon_Material_22:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990914B302_2011273114",-263314,103787,-6164,"Weapon_Material_26:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909CCB202_1291200550",-267952,105496,-10856,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747165487",-265115,108777,-10790,"Weapon_Material_22:6","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_74563CC57EE2F73B02_1314413700",-76978,163988,-418,"Weapon_Material_07:8","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_00FF6172C59CBB4502_1919535540",-117962,161004,-904,"Weapon_Material_07:8","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747104463",-201467,127148,-5804,"Weapon_Material_23:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1750195769",-204485,127954,-3482,"Weapon_Material_20:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909EEF602_1173290179",-278703,28377,-569,"Weapon_Material_06:3","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909569302_1606819970",-46331,261340,-23403,"Weapon_Material_13:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD01F102_1487118509",-27908,119926,-5283,"Ac_Material_1:2","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_74563CC57EE2F73B02_1307880296",-60796,156147,-1435,"Weapon_Material_10:7","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA68FC02_1292571967",-172238,129506,-5581,"Weapon_Material_17:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1454745797",-184208,120525,-3639,"Ac_Material_1:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1454854798",-181303,121571,-3958,"Ac_Material_1:2","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1458285800",-181779,120660,-3242,"Ac_Material_4:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA77B302_1447974591",-185126,115903,-3898,"Weapon_Material_11:7","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909569302_1503089969",-44387,261365,-23283,"Weapon_Material_01:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909589302_1658736340",-42296,261085,-23610,"Weapon_Material_16:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909CCB202_1370091552",-265166,99280,-8261,"Weapon_Material_02:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6CB302_1980840577",-185264,127826,-6457,"Medi_Material_1:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1333901773",-179447,123863,-6001,"Weapon_Material_11:10","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1377072783",-183407,124702,-5223,"Medi_Material_2:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1449215796",-181314,122129,-3571,"Ac_Material_1:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1771670816",-180450,122080,-4967,"Weapon_Material_26:4","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDE9AC02_1620508363",-58828,112137,-2959,"Weapon_Material_08:2","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_E89C25A755A3804902_1822882817",-62198,144880,-766,"Weapon_Material_22:6","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD7A9202_1635889712",-73847,89747,-6222,"Weapon_Material_08:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDD3F402_2003537126",-70428,91163,-6167,"Weapon_Material_05:2","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD720003_1671980079",-209630,82830,7075,"Medi_Material_2:1","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD710003_1762404898",-215312,78753,7425,"Weapon_Material_27:10","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF848099095BFB02_1457787799",-241401,122213,-2610,"Weapon_Material_14:4","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909589302_1094397332",-25817,262499,-23515,"Weapon_Material_10:3","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD6E9202_1353543600",-23888,137737,-3582,"Weapon_Material_14:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909C09202_1431738559",-60858,249624,-22447,"Weapon_Material_10:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_00FF6172C59CBB4502_1884330539",-75174,180975,-4214,"Weapon_Material_16:6","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_D85ED3AAC7CA325402_1504012879",-47681,151093,2395,"Weapon_Material_16:7","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909589302_1292633334",-64968,218871,-16644,"Weapon_Material_22:1","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA96AC02_1408205062",-120482,171437,-1363,"Weapon_Material_04:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C6B202_1596081460",-272747,55528,-6120,"Weapon_Material_25:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909CCB202_1451214553",-274096,52747,-6135,"Weapon_Material_08:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909CCB202_1484965554",-270671,56264,-6182,"Weapon_Material_05:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909D0B202_1376056260",-270537,73540,-7919,"Weapon_Material_02:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1750172761",-268855,70470,-7244,"Weapon_Material_22:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747176491",-241447,108880,-3506,"Weapon_Material_02:4","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD41B802_1380602824",-189275,78141,6796,"Weapon_Material_06:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF848099099D0103_1243504542",-262043,115757,-7238,"Weapon_Material_10:8","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747171489",-256223,55276,-6255,"Weapon_Material_14:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1750183765",-260872,56653,-6380,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747186495",-254064,87761,-4706,"Weapon_Material_05:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA68FC02_1450152973",-157687,94272,834,"Weapon_Material_12:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD45B802_2146030626",-193274,73433,6600,"Weapon_Material_12:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C6B202_1563940458",-273581,59456,-5675,"Weapon_Material_08:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C6B202_1572540459",-274941,59219,-5630,"Weapon_Material_10:8","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDE9AC02_1326490261",-51714,116944,-3268,"Weapon_Material_17:2","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BDE9AC02_1386134262",-57568,115234,-2974,"Weapon_Material_05:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747194498",-246770,124326,-3621,"Weapon_Material_02:4","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA839302_1146215688",-52205,137033,3357,"Weapon_Material_16:8","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD41B802_1564473828",-184588,81142,6720,"Weapon_Material_18:10","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990982B302_1843121519",-232129,112799,-974,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990916B302_1412912538",-257160,42527,-5952,"Weapon_Material_13:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1750198770",-257915,43064,-6051,"Ac_Material_4:1","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD740003_1608128448",-222164,106418,5665,"Weapon_Material_12:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747144479",-276295,50334,-6186,"Medi_Material_2:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Chest_C_UAID_60CF84809909B50003_1598669753",-55088,214230,-18264,"Weapon_Material_01:3|Weapon_Material_07:3","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD40B802_1828612639",-202105,68935,7435,"Weapon_Material_24:13","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD6A0003_1324096548",-200301,66354,8770,"Weapon_Material_12:4","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA71D602_1835855395",-42628,176768,2038,"Weapon_Material_06:15","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA71D602_1835883404",-41855,175404,-1050,"Weapon_Material_21:14","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BDF5E502_1563716950",-218120,85190,7060,"Weapon_Material_12:4","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990982B302_1919416521",-225233,115803,278,"Weapon_Material_08:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747265526",-225418,117597,-324,"Weapon_Material_19:8","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD44B802_1926501433",-208155,91807,4314,"Weapon_Material_17:10","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF8480990919BE02_1294654315",-59958,223809,-16519,"Weapon_Material_07:2","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF84809909549302_1877343601",-62054,220182,-17883,"Weapon_Material_07:2|Weapon_Material_10:3","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_BCFCE7058ACC4DF202_1446708892",-63498,218678,-16554,"Weapon_Material_16:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990953FB02_1783955246",-257799,81329,-5808,"Weapon_Material_20:4","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD6D9202_1554642461",-18839,127423,-3805,"Weapon_Material_05:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA96AC02_1099322053",-9151,173517,-1223,"Weapon_Material_01:6","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_A_C_UAID_60CF848217CA5CF102_1265727255",-62322,140625,-528,"Weapon_Material_02:12","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_A_C_UAID_60CF848217CA5CF102_1344046257",-62771,140754,-528,"Weapon_Material_05:12","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD40F302_1582458648",-56414,103248,428,"Weapon_Material_04:13","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD92E702_1297485816",-54014,107290,-1120,"Weapon_Material_16:9","b"],
["XiGu","PBZ_Xigu_WP-BP_HangingGift_C_UAID_60CF8480990969F002_1211979455",-36353,266026,-25824,"Weapon_Material_07:2|Weapon_Material_10:3","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD690603_1113132996",-63797,125955,679,"Weapon_Material_04:20","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD709202_1458086411",-57789,124023,-2037,"Weapon_Material_10:12","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563C6BC2BD779202_1406370184",-60457,124842,-97,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C6B202_1509772456",-261797,72059,-6297,"Weapon_Material_19:8","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA5F0C03_1361835304",-85316,159345,-7,"Weapon_Material_01:8","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990983E302_1658653332",-235481,110395,-2624,"Weapon_Material_23:3","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990983B302_1292895703",-246210,76935,-4939,"Weapon_Material_05:4","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD42B802_1483730016",-196923,86973,4464,"Weapon_Material_12:4","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD45B802_1981206624",-194455,88672,4450,"Weapon_Material_17:10","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD5FE502_1548908507",-192296,87461,4380,"Weapon_Material_27:10","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD700003_1737351714",-196673,85140,4818,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990982B302_1798426518",-223893,116588,-923,"Weapon_Material_13:6","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909C1B202_2025402533",-221350,116678,-220,"Weapon_Material_05:3","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA68FC02_1435627971",-168660,104234,736,"Weapon_Material_06:3","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA68FC02_1450039972",-170718,106624,518,"Weapon_Material_12:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD100103_1354651016",-209926,98969,4155,"Weapon_Material_26:6","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Rubbish_C_UAID_74563C6BC2BD750003_2078588636",-210708,99611,5103,"Weapon_Material_27:9","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF8480990916B302_1324975470",-254883,49771,-6249,"Weapon_Material_08:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_E89C25A7512647AF02_1747168488",-250932,50035,-6167,"Weapon_Material_02:4","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120899002_1263042440",66327,55588,11380,"Weapon_Material_10:17","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_74563CC57EE2693A02_1908632442",-66168,-62706,14945,"Weapon_Material_18:3","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A7512079FE02_1193550076",-64065,-62841,14947,"Medi_Material_1:8","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120E09102_1122597804",-69617,-59117,13533,"Weapon_Material_18:4","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A7512039D802_1455210972",-51424,-68717,20926,"Weapon_Material_24:5","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120E09102_1130078808",-54374,-68771,20301,"Medi_Material_3:1","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120E09102_1124282805",-74797,-44817,12996,"Weapon_Material_03:5","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A751208F8F02_1296082109",30472,74904,7239,"Medi_Material_1:2","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_74563CC57EE2693A02_1911741371",-60356,-55013,19254,"Medi_Material_3:1","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120869002_1783513897",7216,85506,7658,"Weapon_Material_11:16","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563CC57EE2FD3B02_1153413031",12024,72042,7238,"Weapon_Material_26:11","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1638246093",-195040,-53969,29392,"Weapon_Material_06:9","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_74563CC57EE2693A02_1906197653",-64300,-88421,27112,"Medi_Material_2:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_A_C_UAID_E89C25A750C767DA02_1287350506",-131124,44636,840,"Weapon_Material_06:4","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C706DB02_1203223024",-129644,40130,1038,"Weapon_Material_26:7","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C75B0003_1629606886",-134395,42719,794,"Ac_Material_1:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C765F002_1238049744",-129964,38770,1143,"Weapon_Material_09:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C76BF502_1896550124",-131917,44409,967,"Medi_Material_1:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C76BF502_1762008123",-129694,43452,1123,"Medi_Material_2:1","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120E09102_1392409815",-61744,-102535,20896,"Weapon_Material_24:5","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_74563C6BC2BDCCB302_1806722294",-171337,76518,3826,"Weapon_Material_06:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C794DC02_1582192245",-88065,31002,1127,"Weapon_Material_21:5","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C794DC02_2084268248",-87798,31659,1126,"Ac_Material_1:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Chest_C_UAID_60CF84809909C2D402_1558658538",-248743,69955,-4929,"Weapon_Material_14:3|Weapon_Material_17:6|Weapon_Material_23:4","c"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6CB302_1993999580",-160228,125647,-1840,"Weapon_Material_05:5","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CAA5EC02_1747301771",-163057,126039,-1817,"Weapon_Material_11:7","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98B9B202_1495102834",37388,82120,8668,"Weapon_Material_23:10","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C795DC02_1464432430",-81814,31568,1150,"Weapon_Material_03:2","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C797DC02_1931344857",-82125,26502,1445,"Weapon_Material_17:7","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C797DC02_2084621860",-79435,27338,949,"Medi_Material_2:1","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C2B202_1994985485",-90787,-40467,13503,"Weapon_Material_18:3","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_60CF848A66894BDB02_1981347114",-54530,-55292,18708,"Medi_Material_2:3","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C2B202_2123055496",-51927,-56799,19389,"Weapon_Material_06:5","b"],
["HouJie","PBZ_Houjie_WP-BP_Chest_C_UAID_60CF848099094FD602_1414885428",-265520,109190,-10872,"Weapon_Material_05:4|Weapon_Material_08:4|Weapon_Material_11:5","c"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Chest_C_UAID_E89C25A751206AD402_1707542103",-71976,-87456,25806,"Weapon_Material_02:18|Weapon_Material_05:20|Weapon_Material_11:20","c"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120B2B302_1978283871",-64640,-73228,20235,"Weapon_Material_09:5","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120BA8D02_1834674295",24297,75237,7206,"Medi_Material_2:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A7512081FE02_1557545532",-180637,525,1839,"Medi_Material_1:2","b"],
["HouJie","PBZ_Houjie_WP-BP_Chest_C_UAID_60CF8480990999F702_1669803281",-200210,130420,-7790,"Weapon_Material_05:4|Weapon_Material_08:3|Weapon_Material_11:7","c"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A7512054D602_1784136355",52173,66464,14292,"Weapon_Material_12:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_HangingGift_C_UAID_60CF848217CA1EEF02_1662492187",-42981,180616,3635,"Weapon_Material_09:11","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C2B202_1349179478",-64794,-57526,18361,"Weapon_Material_23:8","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C2B202_1951341484",-65043,-52664,13276,"Weapon_Material_12:10","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A7512079FE02_1651404078",-71641,-87005,25824,"Weapon_Material_15:4","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C7E0E202_1647625618",-130929,29934,836,"Weapon_Material_06:3","b"],
["MeiGu_YiJi","PBZ_Huanshuyiji2_WP-BP_Rubbish_C_UAID_E89C25A751203DF302_1760889142",-176965,-7030,1361,"Weapon_Material_12:4","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C2B202_2123061498",-81810,-48412,13598,"Weapon_Material_09:5","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF8480990999F202_2062696034",-54038,241871,-19359,"Weapon_Material_05:1","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_60CF848099099BF202_1414156417",-56241,237304,-20612,"Weapon_Material_08:1","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98BFB202_1289681910",44595,86077,9428,"Weapon_Material_10:17","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C708FC02_1507490063",-105224,3903,880,"Weapon_Material_06:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C76BB302_1241887427",-105536,248,1267,"Medi_Material_1:1","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177841064",-190885,-94359,36542,"Weapon_Material_12:13","b"],
["HuanShuShi","PBZ_Huanshuyiji2_WP-BP_Rubbish_C_UAID_E89C25A75120039302_1940199570",-186003,-5371,2350,"Weapon_Material_24:9","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98BEB202_2076253725",-8239,118729,321,"Weapon_Material_20:6","b"],
["MeiGu_YiJi","PBZ_Huanshuyiji2_WP-BP_Rubbish_C_UAID_E89C25A75120049302_1112961764",-155052,-21506,-5139,"Weapon_Material_18:12","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120889002_1441784260",40284,68372,9668,"Ac_Material_4:4","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120899002_1141933439",41617,65673,8736,"Weapon_Material_23:10","b"],
["MeiGu_YiJi","PBZ_Huanshuyiji2_WP-BP_Rubbish_C_UAID_60CF848A668979DD02_1652786373",-178817,2434,816,"Weapon_Material_03:12","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120D1F902_2000366351",65648,59342,11324,"Ac_Material_1:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1449100795",-170241,122269,-3521,"Ac_Material_1:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1458172799",-170519,121950,-3447,"Ac_Material_4:1","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_E89C25A7512085D802_1224734048",37437,69951,7601,"Weapon_Material_12:6|Weapon_Material_26:3","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_74563C6BC2BDCBB302_1586917100",-173103,90828,3250,"Weapon_Material_09:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A7512065DA02_1542598825",32301,75509,6844,"Weapon_Material_14:10","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1329183770",-197943,138651,-5927,"Weapon_Material_11:9","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1333790772",-193170,136689,-5887,"Weapon_Material_08:5","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA77B302_1417140589",-192709,139241,-6647,"Weapon_Material_17:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1358769776",-163827,128571,-1702,"Weapon_Material_26:4","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120B2B302_1481111865",-47752,-60436,20739,"Weapon_Material_15:3","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177604012",-199359,-86358,37213,"Weapon_Material_21:15","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C1B202_1221703292",-63546,-96030,29243,"Weapon_Material_27:5","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120B2EB02_1149434127",-59547,-100995,20896,"Weapon_Material_15:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98B8B202_1578857641",5369,81893,3715,"Weapon_Material_06:3","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA57F102_1997369334",-177867,128797,-6253,"Weapon_Material_12:5","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA58F102_1084943511",-177012,128822,-6537,"Weapon_Material_05:15","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6CB302_1977606576",-174411,130060,-5537,"Medi_Material_1:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1302997762",-173466,128726,-6057,"Weapon_Material_14:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1333904774",-175657,130240,-5547,"Weapon_Material_23:4","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A7512094EE02_1319494142",-60836,-66314,22441,"Ac_Material_4:2","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120B1EB02_2132706950",-59080,-67330,23097,"Weapon_Material_12:14","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120E09102_1388576813",-62889,-64607,15832,"Weapon_Material_15:4","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_74563CC57EE2693A02_1916215049",-60620,-47610,17880,"Weapon_Material_21:5","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_HangingGift_C_UAID_BCFCE7058ACC9DCB02_1222139115",-42378,175967,1775,"Ac_Material_1:2","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_HangingGift_C_UAID_BCFCE7058ACC9DCB02_1223331380",-43887,178283,7007,"Medi_Material_3:2","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_60CF848A668944DB02_1580105783",-87427,-45397,13469,"Weapon_Material_06:5","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98B9B202_1393128830",37265,63476,10636,"Weapon_Material_09:3","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1318344767",-195996,132994,-4787,"Weapon_Material_20:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1329187771",-198316,131390,-5322,"Weapon_Material_05:4","b"],
["MeiGu_YiJi","PBZ_Huanshuyiji2_WP-BP_Rubbish_C_UAID_E89C25A75120039302_1947159582",-193482,-14128,2129,"Weapon_Material_06:8","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CAA5EC02_1641591770",-163898,100102,2150,"Weapon_Material_03:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE788D449C47002_2094368094",-822,89351,3512,"Weapon_Material_03:3","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177471986",-200367,-104233,32080,"Weapon_Material_06:9","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177619015",-201943,-103491,32080,"Weapon_Material_03:14","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_E89C25A7512084D802_1149243871",10404,89060,6159,"Weapon_Material_10:17|Weapon_Material_26:3","c"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177783051",-194046,-67491,31246,"Weapon_Material_12:13","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A75120E09102_1133439811",-69616,-47965,14476,"Weapon_Material_24:5","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A7512037EE02_1452654555",-5310,79518,5228,"Weapon_Material_09:3","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A7512079FE02_1252543077",-55012,-62989,17945,"Weapon_Material_05:13","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C7D9F902_1354805684",-137631,41344,1219,"Weapon_Material_03:5","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C7D9F902_1627754686",-138103,41230,1270,"Medi_Material_2:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C700DB02_1690590946",-135036,41013,1169,"Weapon_Material_12:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120879002_1091365076",2767,97712,4299,"Weapon_Material_09:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120BA8D02_1782002294",23978,82261,8650,"Weapon_Material_17:10","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177307954",-198958,-97712,40726,"Weapon_Material_06:9","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177383969",-199287,-100044,37674,"Weapon_Material_12:13","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98B9B202_1363809828",-4775,94644,4291,"Weapon_Material_12:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120879002_1274426078",-4233,92552,4497,"Medi_Material_2:1","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_HangingGift_C_UAID_E89C25A751204EF202_2123103000",-205160,-88448,36760,"Weapon_Material_12:14|Weapon_Material_15:13|Weapon_Material_21:15","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6BB302_1375787387",-159777,131296,-2347,"Weapon_Material_14:3","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6BB302_1524484388",-157065,133677,-2689,"Weapon_Material_11:8","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6BB302_1540800389",-156147,132159,-2415,"Ac_Material_1:1","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_00FF6172C59CBC4502_2114375726",6744,160112,-1053,"Ac_Material_1:1","b"],
["MeiGu_YiJi","PBZ_Huanshuyiji2_WP-BP_Rubbish_C_UAID_E89C25A75120049302_1490819772",-165355,-41733,-2617,"Weapon_Material_15:12","b"],
["HouJie","PBZ_Houjie_WP-BP_Chest_C_UAID_60CF848099094FD602_1344999427",-258361,105486,-3595,"Weapon_Material_17:6|Weapon_Material_20:2|Weapon_Material_23:5","c"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909B0F002_1758693001",-255871,103900,-5336,"Weapon_Material_05:10","b"],
["HouJie","PBZ_Houjie_WP-BP_Rubbish_C_UAID_60CF84809909B0F002_1792633002",-255397,104058,-5098,"Weapon_Material_02:10","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98B8B202_1989030646",3244,106373,3377,"Weapon_Material_06:4","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98B9B202_1604168835",1880,104565,3336,"Weapon_Material_23:5","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_E89C25A7512066F002_1812148063",21200,80854,7724,"Ac_Material_4:1|Weapon_Material_23:3","c"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A7512036EE02_1771182368",13832,83167,5275,"Weapon_Material_03:3","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C0B202_1805915111",-60674,-70517,18083,"Weapon_Material_02:11","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CAD8EE02_1153770083",-45041,164104,-129,"Weapon_Material_15:14|Weapon_Material_18:9|Weapon_Material_27:7","c"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1377068782",-178009,118562,-4057,"Weapon_Material_20:4","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C7FEDA02_1978164472",-99587,26047,1090,"Medi_Material_1:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C700DB02_1958041948",-97530,31044,1201,"Weapon_Material_06:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_60CF848A66893FDD02_1202040269",-154753,-38063,789,"Weapon_Material_06:15","b"],
["HouJie","PBZ_Houjie_WP-BP_Chest_C_UAID_60CF84809909B0F002_1550604998",-259543,110167,-5393,"Ac_Material_4:1|Medi_Material_2:1|Weapon_Material_11:12","c"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_74563CC57EE2FD3B02_1151619432",13051,83550,7445,"Weapon_Material_12:3","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1348994775",-194732,117912,-4272,"Weapon_Material_08:5","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A75120A7D602_1978641421",-156787,-31378,754,"Ac_Material_1:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA00FB02_1244635571",-178931,124201,-5571,"Weapon_Material_02:4","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA58F102_1427707514",-177576,127657,-6077,"Weapon_Material_07:11","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_60CF8480990943FD02_1655486675",-192341,75024,1704,"Weapon_Material_08:10|Weapon_Material_09:4|Weapon_Material_12:2","c"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120D2F902_2016207544",42740,85181,9648,"Weapon_Material_26:11","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_A_C_UAID_E89C25A750C7CEFF02_1482109072",-92354,34323,1598,"Medi_Material_2:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C7C3B302_1283489065",-92831,33527,1601,"Weapon_Material_23:7","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Chest_C_UAID_E89C25A751200BF102_1396627073",-192595,-80242,34468,"Weapon_Material_03:15|Weapon_Material_06:4|Weapon_Material_12:16","c"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A7512093EE02_2058626964",-74250,-44461,13012,"Weapon_Material_02:12","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177297952",-196471,-80281,34352,"Ac_Material_4:1","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177526997",-194436,-82922,34512,"Weapon_Material_15:15","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177599011",-193222,-88220,34559,"Medi_Material_3:4","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177609013",-197955,-86442,40664,"Weapon_Material_18:15","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120C89102_1175122435",38055,64022,8070,"Weapon_Material_20:6","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98B9B202_1784209841",40439,80811,9413,"Weapon_Material_11:16","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_HangingGift_C_UAID_E89C25A751200A8D02_2109025139",4440,99020,3106,"Weapon_Material_01:7|Weapon_Material_07:9","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C770B302_1782904739",-94071,26326,1436,"Weapon_Material_05:5","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C708FC02_2114581064",-91652,26970,1446,"Medi_Material_1:1","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A7512085D802_1986088049",21766,83828,7821,"Medi_Material_1:1","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C2B202_2051326490",-59852,-92325,29023,"Weapon_Material_09:6","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A7512094EE02_1485170144",-63590,-95000,29312,"Medi_Material_3:1","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A75120B2EB02_1870522170",46045,72145,9003,"Weapon_Material_12:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A7512082D802_1836405514",1421,112141,964,"Medi_Material_3:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Chest_C_UAID_60CF8480990940E802_1488620898",-258411,55471,-6285,"Weapon_Material_05:4|Weapon_Material_08:4|Weapon_Material_11:5","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C757FC02_1326242005",-119953,73787,973,"Weapon_Material_06:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA86EE02_1490708520",-20010,189656,-1188,"Weapon_Material_06:15","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177521996",-206125,-79810,37132,"Medi_Material_3:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98B9B202_1241645825",-9849,98274,3361,"Ac_Material_1:1","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_74563CC57EE2693A02_1911449162",-63540,-62310,15840,"Weapon_Material_06:4","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C1B202_1255350293",-68143,-65892,13933,"Weapon_Material_03:6","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA65B302_1766447332",-158475,127772,-1800,"Medi_Material_1:1","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1285262758",-155257,127732,-2047,"Weapon_Material_08:4","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_E89C25A7512083D802_1333188692",40471,76206,7338,"Medi_Material_3:1|Weapon_Material_20:4","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_60CF848099090DDF02_1921104294",-181319,75641,2714,"Weapon_Material_14:8|Weapon_Material_20:8|Weapon_Material_27:2","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_E89C25A75120ABF102_1920296202",-177318,-7770,995,"Weapon_Material_15:12|Weapon_Material_18:12|Weapon_Material_21:12","c"],
["HouJie","PBZ_Houjie_WP-BP_Chest_C_UAID_60CF848099094FD602_1131583425",-210862,121493,-1855,"Weapon_Material_05:4|Weapon_Material_08:4|Weapon_Material_11:6","c"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Chest_C_UAID_E89C25A7512038D802_1626352795",-54952,-63515,17891,"Weapon_Material_18:8|Weapon_Material_21:7|Weapon_Material_27:11","c"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848217CA6DB302_1411006793",-160767,142946,-7647,"Weapon_Material_01:8","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Chest_C_UAID_E89C25A7512021DF02_1806195176",-201951,-88828,36918,"Weapon_Material_03:11|Weapon_Material_09:8|Weapon_Material_12:16","c"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_BCFCE7058A98C2B202_1252737476",-48883,-69022,18366,"Weapon_Material_09:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_E89C25A7512083D802_1841235694",37273,82903,8150,"Weapon_Material_03:6|Weapon_Material_06:8|Weapon_Material_12:6","c"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98BFB202_1304589914",2767,117003,1496,"Weapon_Material_12:3","b"],
["PangZhen","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A75120A7D602_1830160418",-182748,134385,-6041,"Ac_Material_1:1","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Chest_C_UAID_E89C25A7512037D802_1883947618",-59608,-55751,18290,"Weapon_Material_02:19|Weapon_Material_08:20|Weapon_Material_11:20","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C77BD902_1862916533",-102163,29151,717,"Weapon_Material_17:7","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C701DB02_1657763128",-106216,-2428,1281,"Weapon_Material_24:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C76BB302_1289518428",-106558,-1737,1187,"Medi_Material_2:1","b"],
["HouJie","PBZ_Houjie_WP-BP_Chest_C_UAID_60CF84809909A60203_1640037214",-274508,83009,-7777,"Weapon_Material_02:3|Weapon_Material_08:5|Weapon_Material_11:6","c"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A7512082D802_1830966512",6600,79628,6899,"Weapon_Material_20:12","b"],
["DuanHunYa","PBZ_Duanhun_WP-BP_Rubbish_C_UAID_74563C6BC2BD32B802_1177516995",-209055,-93777,36662,"Weapon_Material_09:14","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_60CF848A66894DDB02_1327115500",-62301,-84815,26084,"Weapon_Material_24:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_A_C_UAID_E89C25A750C76ADF02_1921510735",-99266,25503,719,"Weapon_Material_03:5","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_A_C_UAID_E89C25A750C78EF702_1640213391",-99483,21215,1030,"Medi_Material_2:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C7C1F502_2081815343",-98420,24781,1502,"Weapon_Material_09:5","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C7CEFF02_1395943071",-100447,22749,788,"Medi_Material_3:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A75120A7D602_1357234415",-152337,-39947,1365,"Weapon_Material_12:10","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_74563C6BC2BDCCB302_1227828288",-178204,76546,2716,"Medi_Material_1:1","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A7512036EE02_1887552369",41603,90529,9664,"Weapon_Material_12:4","b"],
["MeiGu_YiJi","PBZ_Huanshuyiji2_WP-BP_Rubbish_C_UAID_E89C25A75120039302_1946173578",-175610,-1370,662,"Weapon_Material_27:9","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_BCFCE7058A98BFB202_1304592915",-4459,74245,5224,"Weapon_Material_14:9","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_HangingGift_C_UAID_E89C25A751200B8D02_1773793548",4016,84795,6936,"Weapon_Material_10:18|Weapon_Material_11:4","b"],
["MeiGu_YiJi","PBZ_Huanshuyiji2_WP-BP_Rubbish_C_UAID_E89C25A7512092EE02_1208877736",-169973,-6546,712,"Weapon_Material_03:3","b"],
["ZhengDaoDaYing","PBZ_Zhengdaodaying_WP-BP_Rubbish_C_UAID_E89C25A7512085D802_2078349050",16395,71790,7415,"Weapon_Material_03:3","b"],
["DengDingShanDao","PBZ_DengDingShanDao_WP-BP_Rubbish_C_UAID_E89C25A7512093EE02_2145656965",-69442,-40056,15741,"Weapon_Material_27:5","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA84EE02_1858796162",-15929,201057,-3978,"Weapon_Material_24:14","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA34EE02_2018723044",-25491,176209,726,"Medi_Material_3:1","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C757FC02_1161734968",-50751,20141,2211,"Weapon_Material_06:4","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD0AF502_1871815131",-67858,103370,-5930,"Weapon_Material_05:2|Weapon_Material_10:12","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_E89C25A750C70B0C03_1314798561",-7469,4291,1140,"Weapon_Material_02:7|Weapon_Material_06:4|Weapon_Material_12:4","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_E89C25A750C712E002_2038969365",-134831,39936,1076,"Weapon_Material_17:8|Weapon_Material_20:9|Weapon_Material_23:8","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD690003_1472528357",-197258,68062,8910,"Weapon_Material_09:8|Weapon_Material_12:7","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD1B0003_1930897927",-227139,70691,14923,"Weapon_Material_12:7","c"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_A_C_UAID_E89C25A750C7CEF402_1120685429",-68296,213339,2040324,"Weapon_Material_11:15","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD4FF202_1943618283",-18607,131057,-3771,"Weapon_Material_02:2|Weapon_Material_11:8","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD07FC02_1333591088",-49072,118811,-3249,"Weapon_Material_02:4|Weapon_Material_11:8","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C709FC02_1394968242",-79215,24070,791,"Weapon_Material_15:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C766F502_1196888228",-36883,49894,957,"Weapon_Material_03:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD740003_1783844450",-220716,108083,5760,"Weapon_Material_09:8","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD6A0003_1804043551",-203145,71525,8035,"Weapon_Material_03:7|Weapon_Material_12:6","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD6B0003_1109056728",-199752,71760,6710,"Medi_Material_3:1","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD6E0003_1345337287",-180085,89834,6045,"Weapon_Material_03:7|Weapon_Material_06:7","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C76AB302_2138077248",-93534,25508,1422,"Medi_Material_1:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C795DC02_1398032429",-92847,25303,1427,"Weapon_Material_18:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF8480990942FD02_1709048497",-181678,80084,1715,"Weapon_Material_03:3","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BDD6F202_2099678866",-22236,135391,-3961,"Weapon_Material_08:2","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD760003_1475859815",-200284,89093,4400,"Weapon_Material_14:20|Weapon_Material_15:11","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BDE1F202_1791963806",-42126,123822,-3118,"Weapon_Material_11:9|Weapon_Material_20:2","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_E89C25A750C75CE602_1314928674",-111020,3893,889,"Weapon_Material_03:4|Weapon_Material_08:4|Weapon_Material_12:4","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD710003_1217958892",-193299,82133,6380,"Weapon_Material_03:7|Weapon_Material_12:7","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA80EE02_1911368399",-45758,177304,-2416,"Medi_Material_3:1|Weapon_Material_12:14","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA82EE02_2018898784",-45021,176766,6693,"Medi_Material_3:4","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD0AF502_1849327130",-62035,107800,-2011,"Weapon_Material_05:3|Weapon_Material_10:12|Weapon_Material_11:8","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C779D902_1116686166",-124428,75035,735,"Weapon_Material_12:3","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_A_C_UAID_E89C25A750C7CEF402_2138296433",-70497,213971,2041268,"Weapon_Material_20:5","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_A_C_UAID_E89C25A750C7D0F402_1749902795",-71697,212760,2040266,"Weapon_Material_05:12","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD760003_1493912816",-201730,89767,4400,"Weapon_Material_03:8|Weapon_Material_06:7","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD730003_2005168267",-214540,111148,4325,"Weapon_Material_06:7|Weapon_Material_09:8","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA79EE02_2068628231",-40647,179684,3373,"Ac_Material_4:1","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C75B0003_1600580885",-133677,32212,1329,"Weapon_Material_03:4","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C764F002_2090581565",-132084,36489,1902,"Medi_Material_1:1","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD0AF502_1965827140",-64191,89991,-5611,"Weapon_Material_13:8|Weapon_Material_20:2","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_A_C_UAID_E89C25A750C753FC02_1620155253",-149540,93435,817,"Weapon_Material_09:5","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD31F302_1500167221",-53062,108340,-1029,"Weapon_Material_01:13|Weapon_Material_07:12","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD3FF302_1414231274",-53239,105843,115,"Weapon_Material_05:3|Weapon_Material_07:12","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD86F302_2073177850",-55972,108699,-576,"Weapon_Material_07:12|Weapon_Material_26:2","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD87F302_1207038027",-54734,102479,-1997,"Weapon_Material_04:17|Weapon_Material_10:12","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD87F302_1316383028",-55190,104502,-1999,"Weapon_Material_19:9","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD88F302_1203641213",-59694,97301,-1809,"Weapon_Material_01:14|Weapon_Material_02:2","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD710003_1804006899",-213041,75339,6955,"Weapon_Material_12:6|Weapon_Material_23:20","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD6F0003_1610313530",-186712,90955,4440,"Ac_Material_4:1","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BDE7F202_1925200081",-59247,120285,-385,"Weapon_Material_07:12|Weapon_Material_25:9","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD39F302_1889887106",-48907,102196,1598,"Weapon_Material_22:8|Weapon_Material_23:2","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF8480990918DF02_2139580339",-167353,77781,841,"Weapon_Material_09:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD6B0003_2100027737",-185988,78391,6735,"Weapon_Material_03:7|Weapon_Material_12:6","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BDECF202_1340227981",-56932,119177,-1356,"Weapon_Material_16:9","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA22EF02_2053981950",4441,159428,-959,"Weapon_Material_06:18|Weapon_Material_09:18|Weapon_Material_12:15","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA87EE02_1076395701",4409,157215,-719,"Weapon_Material_03:18|Weapon_Material_09:18|Weapon_Material_12:17","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA86EE02_2061152524",-1333,161267,-1089,"Weapon_Material_18:10|Weapon_Material_24:14|Weapon_Material_27:6","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_60CF84809909AA0C03_1681511451",-179570,69811,3934,"Ac_Material_1:1|Weapon_Material_14:3","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_E89C25A750C789EE02_1143475979",-125834,32807,1047,"Ac_Material_1:1","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD4DF202_1816511928",-41812,106227,399,"Weapon_Material_01:13","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C707FC02_2064366883",-97670,1519,881,"Weapon_Material_12:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C700DB02_2138492951",-7284,-1769,735,"Weapon_Material_12:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C709FC02_1157580241",-104785,26700,727,"Weapon_Material_12:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA71D602_1835765387",-46019,177215,569,"Ac_Material_1:2","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CA5BF102_1799079078",-51332,143046,-575,"Weapon_Material_02:20|Weapon_Material_06:12|Weapon_Material_18:8","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848099090DDF02_2074625295",-180439,77199,2727,"Weapon_Material_26:7","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD9DF702_2006048174",-210346,75362,6708,"Weapon_Material_03:8|Weapon_Material_12:7","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD700003_1335425710",-193603,83377,5150,"Medi_Material_3:1","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C76BB302_1110243425",-75686,26603,788,"Weapon_Material_27:3","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD89F302_1650738394",-50083,89218,1872,"Weapon_Material_05:2|Weapon_Material_08:2|Weapon_Material_14:2","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C7ABEA02_1265506732",-52616,16047,2509,"Weapon_Material_03:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C7C5FF02_1663437485",-50875,9620,2276,"Weapon_Material_09:6","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C7D2F902_1829372515",14197,19250,737,"Weapon_Material_12:4","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C7FFDA02_1321736651",13232,22369,753,"Weapon_Material_03:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_E89C25A750C797DC02_1847364843",-81518,27354,1440,"Weapon_Material_02:10|Weapon_Material_09:4|Weapon_Material_12:4","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BDEC0103_1550784488",-228059,89679,7090,"Medi_Material_3:1|Weapon_Material_09:6","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_HangingGift_C_UAID_60CF848217CA1DEF02_1700645006",-25828,175147,1015,"Weapon_Material_06:12","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA71D602_1835832388",-25789,163904,823,"Weapon_Material_15:14","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C770B302_2048520747",-101400,7057,767,"Weapon_Material_15:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C71EEA02_1235210024",-34146,46637,978,"Weapon_Material_27:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C71BF502_1909893048",-79692,28308,742,"Weapon_Material_06:5","b"],
["XiGu","PBZ_Xigu_WP-BP_Rubbish_C_UAID_E89C25A750C7C7F402_1696237211",-77091,209394,2034871,"Weapon_Material_06:4","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CAD5EE02_1528109542",-40812,155097,1461,"Weapon_Material_09:12|Weapon_Material_12:17","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C77BD902_1424646530",-43821,-10822,717,"Weapon_Material_06:4","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C77BD902_1497999531",-38505,-8473,740,"Weapon_Material_12:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_A_C_UAID_E89C25A750C7CEFF02_1952104074",-93340,2825,771,"Weapon_Material_03:4","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C70B0C03_1611815564",-39239,51642,947,"Weapon_Material_12:3","b"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Chest_C_UAID_60CF848217CAD9E302_1144974592",-11973,170067,-1209,"Medi_Material_3:1","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C77BD902_1738899532",-14153,-1434,721,"Weapon_Material_03:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD660003_1776147823",-202922,61102,10060,"Weapon_Material_12:7|Weapon_Material_21:10","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD6B0003_1406778729",-204512,59047,6810,"Medi_Material_3:1","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C706DB02_1569028025",-6186,3628,747,"Weapon_Material_06:3","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C76BB302_1200797426",-110308,6079,1150,"Medi_Material_1:1","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_b_C_UAID_E89C25A750C7E30303_2121730084",-111491,3003,1231,"Weapon_Material_09:4","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BDE2F202_1464942118",-53627,127395,-1448,"Weapon_Material_04:17|Weapon_Material_19:9","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BDE5F202_1892928689",-55201,127413,-663,"Weapon_Material_01:14|Weapon_Material_05:2","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF848099090DDF02_1537345292",-184510,66100,2886,"Weapon_Material_18:3","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD1C0003_1648855106",-223540,59435,14532,"Weapon_Material_12:7","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA71D602_1835859396",-29293,188406,-188,"Weapon_Material_21:14","b"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_E89C25A750C7A60203_1695562382",-108333,-7524,765,"Ac_Material_1:1","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD240003_2144487620",-216330,67705,10095,"Ac_Material_1:1","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD1E0003_2045936459",-229601,64698,14754,"Weapon_Material_09:7","c"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD6E0003_1657420289",-179689,101362,4375,"Ac_Material_1:1","c"],
["FuJiZhiLin","PBZ_Fujizhilin_WP-BP_Rubbish_C_UAID_60CF848217CA86EE02_1635230521",-13006,176016,362,"Weapon_Material_03:15","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD8AF302_2127736595",-42524,94423,3685,"Weapon_Material_05:2|Weapon_Material_10:12|Weapon_Material_11:9","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BDD0F402_1443134542",-46561,111085,-730,"Weapon_Material_04:13|Weapon_Material_05:2","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BDEFF202_1155932577",-49722,113633,-1203,"Weapon_Material_08:2","c"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD42F202_1479507818",-71926,87979,-6015,"Ac_Material_4:1","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_60CF8480990919DF02_1211112516",-167119,65477,751,"Weapon_Material_12:3","b"],
["LuJiaCun","PBZ_Zhengdaodaying_WP-BP_Chest_C_UAID_74563C6BC2BD8DF302_1283235163",-42904,101942,1784,"Weapon_Material_13:7|Weapon_Material_20:2","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Chest_C_UAID_E89C25A750C793DC02_1913747067",-91299,33396,1284,"Weapon_Material_14:6|Weapon_Material_24:5|Weapon_Material_26:8","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_Rubbish_C_UAID_E89C25A750C7FFDA02_1461014653",-28038,51004,961,"Weapon_Material_09:2","b"],
["XiMeng","PBZ_Ximeng_WP-BP_Chest_C_UAID_74563C6BC2BD750003_1710780632",-210842,98717,4056,"Weapon_Material_06:8|Weapon_Material_09:8|Weapon_Material_20:12","c"],
["MeiGuHu","PBZ_Pangzhen_WP-BP_HangingGift_C_UAID_E89C25A750C7A6F702_1820039582",-104878,3643,1302,"Weapon_Material_02:6|Weapon_Material_05:8","b"],
];
const MATERIAL_TINT = [0.45, 0.9, 0.95];
const MATERIAL_PIC = PIC + "WeaponGear.T_Map_CollectionProgress_WeaponGear";
// Spots in a level data layer that the story switches on. Their jar or chest only exists while the story tag is set:
// 血色森林 in the snowstorm (flow BPF_DataLayer_Snow loads DataLayer_66FFCDA9...; the same tag picks the winter map picture
// in DT_MapData).
const MATERIAL_STORY_TAGS = [
    ["fjzl.风雪数据层.激活", "PBZ_Fujizhilin_WP-", [
        "BP_Chest_C_UAID_60CF848217CA22EF02_2053981950",
        "BP_Chest_C_UAID_60CF848217CA34EE02_2018723044",
        "BP_Chest_C_UAID_60CF848217CA86EE02_2061152524",
        "BP_Chest_C_UAID_60CF848217CA87EE02_1076395701",
        "BP_Chest_C_UAID_60CF848217CAD5EE02_1528109542",
        "BP_Chest_C_UAID_60CF848217CAD8EE02_1153770083",
        "BP_Chest_C_UAID_60CF848217CAD9E302_1144974592",
        "BP_HangingGift_C_UAID_60CF848217CA1DEF02_1700645006",
        "BP_Rubbish_C_UAID_60CF848217CA71D602_1835832388",
        "BP_Rubbish_C_UAID_60CF848217CA71D602_1835859396",
        "BP_Rubbish_C_UAID_60CF848217CA84EE02_1858796162",
        "BP_Rubbish_C_UAID_60CF848217CA86EE02_1490708520",
        "BP_Rubbish_C_UAID_60CF848217CA86EE02_1635230521",
    ]],
];
const MATERIAL_TAG_OF = new Map();
for (const [tag, level, actors] of MATERIAL_STORY_TAGS)
    for (const a of actors)
        MATERIAL_TAG_OF.set(level + a, tag);
// A second label line saying how the item is obtained, read from the source fields of the map data (the same ones the
// game uses to tell whether the item was collected): the enemy group that drops it, the story flow that gives it (boss
// death, NPC, event) or the actor it is in. Weapons, shadow weapons, accessories, medicines, Black Stone, Amber and keys
// get it.
const SOURCE_TEXTS = {
    hant: { boss: "擊敗強敵後獲得", mob: "擊敗此處敵人後獲得", npc: "NPC／任務給予", door: "開啟門或機關後獲得", event: "劇情事件中獲得", chest: "寶箱中", breakable: "可破壞物中" },
    hans: { boss: "击败强敌后获得", mob: "击败此处敌人后获得", npc: "NPC／任务给予", door: "开启门或机关后获得", event: "剧情事件中获得", chest: "宝箱中", breakable: "可破坏物中" },
    en: { boss: "Defeat a boss to get it", mob: "Defeat the enemies here", npc: "Given by an NPC (quest)", door: "Behind a door or mechanism", event: "From a story event", chest: "In a chest", breakable: "Inside a breakable object" },
};
// the same line with a name ({0}, the game's own text for that boss, NPC or enemy)
const SOURCE_NAMED = {
    hant: { boss: "擊敗「{0}」後獲得", npc: "NPC「{0}」給予（任務）", mob: "擊敗此處的「{0}」後獲得", flower: "記憶之花中獲得" },
    hans: { boss: "击败「{0}」后获得", npc: "NPC「{0}」给予（任务）", mob: "击败此处的「{0}」后获得", flower: "记忆之花中获得" },
    en: { boss: "Defeat \"{0}\" to get it", npc: "Given by \"{0}\" (NPC quest)", mob: "Defeat the \"{0}\" here", flower: "From a Memory Flower" },
};
// story flow of the map data -> who gives the item: kind and the text key of the name (BossName_*, Character_* and
// EnemyName_* rows of the game's text table). Flows not listed keep the plain line.
const SOURCE_WHO = {
    BPF_CanGangDeath: "boss:BossName_003", BPF_ChangHongDeath: "boss:BossName_014_1",
    BPF_ChiYingGuRen_Kill: "boss:BossName_049", BPF_DangHuiDeath: "boss:BossName_017",
    BPF_DuYanGongKe_Death: "boss:BossName_030", BPF_DuoLuoJiangJun_Death: "boss:BossName_038",
    BPF_FengXueDaoKe_Death: "boss:BossName_050", BPF_FuLaoDaDeath: "boss:BossName_004",
    BPF_HongYiGuiChai_Death: "boss:BossName_021", BPF_HuangXingZiDeath_2: "boss:BossName_035_1",
    BPF_JianChiDeath: "boss:BossName_007", BPF_JianOuQiangOu_Death: "boss:BossName_016_02",
    BPF_JianZhenDeath: "boss:BossName_013_1", BPF_LeiDangOrYuer_Dead: "boss:BossName_039",
    BPF_MengHua_Death: "boss:BossName_054_1", BPF_MuXiaoKuiDeath: "boss:BossName_020_1",
    BPF_QingDaoFu_Dead: "boss:BossName_036", BPF_QuanChiDeath: "boss:BossName_008",
    BPF_SanTouMoOuDeath: "boss:BossName_051_2", BPF_WanJunKeDeath: "boss:BossName_012",
    BPF_WuLengShuangDeath: "boss:BossName_015", BPF_XinNiang_Death: "boss:BossName_005",
    BPF_YouLong_Death: "boss:BossName_037", BPF_YouLong_No2_Death: "boss:BossName_066",
    BPF_YuMianDeath: "boss:BossName_034", BPF_YuZanDeath: "boss:BossName_019",
    BPF_ZhangMenBenTi: "boss:BossName_063", BPF_ZhangMenBenTi_2: "boss:BossName_064",
    BPF_ZhuiMingDeath: "boss:BossName_002", BPF_ZhuoBiDead: "boss:BossName_031",
    BPF_YuGongKeYingDi_Death: "mob:EnemyName_018",
    BPF_BaGuaTongZi: "npc:Character_PZ_1", BPF_BaiXueEr: "npc:Character_PZ_25",
    BPF_HuaDan_01: "npc:Character_PZ_74", BPF_HuanGui: "npc:Character_Imp_4",
    BPF_JiuLou_YuLing_01: "npc:Character_PZ_75", BPF_JiuRenFeiZei_1: "npc:Character_LJC_51",
    BPF_LJC_LaoGenTou: "npc:Character_Imp_16", BPF_LaoGenTou: "npc:Character_Imp_16",
    BPF_PZ_LaoGenTou: "npc:Character_Imp_16", BPF_LanShaoDi_2: "npc:Character_EX_2",
    BPF_LaoGongShou_New: "npc:Character_XG_38", BPF_LeiDang_Npc_JYX: "npc:Character_Imp_8",
    BPF_LiangShangFei: "npc:Character_FJZL_49_1", BPF_LiuYi: "npc:Character_DDSD_6",
    BPF_LuSanQian3_New: "npc:Character_DDSD_2", BPF_NiuZhangGui_01: "npc:Character_PZ_72",
    BPF_NvZhi: "npc:Character_LJC_12", BPF_ShouShangDeFeiZei: "npc:Character_LJC_7",
    BPF_XMSZ_LaoQiGai: "npc:Character_EX_4", BPF_XiGu_HuoLang: "npc:Character_XG_15",
    BPF_XiaoZhang2: "npc:Character_Imp_5", BPF_XiaoZhang_LJC: "npc:Character_Imp_5",
    BPF_XiaoZhang_MGH: "npc:Character_Imp_5", BPF_XiaoZhang_PZ: "npc:Character_Imp_5",
    BPF_XiaoZhang_XMSZ: "npc:Character_Imp_5", BPF_YuEr_FJZL: "npc:Character_Imp_1",
    BPF_YuEr_XG: "npc:Character_Imp_1",
};
const SOURCE_LISTS = ["HeiShiItemData", "HupoItemData", "YaoShiItemData"];
// Map IDs whose items sit in a separate level that the game still draws on another region's map: MeiGu_YiJi is shown on
// the Meigu Lake map, but its items are inside the Illusionist's Ruins, so at the marked spot on the surface there is
// nothing. name: text key of the area's name.
const OTHER_LEVEL_MAPS = { meigu_yiji: { name: "BrokenBell_HSSYJ_01" } };
const OTHER_LEVEL_TEXTS = {
    hant: { line: "位於「{0}」內（另一個區域，地面上沒有）", name: "幻術師遺跡" },
    hans: { line: "位于「{0}」内（另一个区域，地面上没有）", name: "幻术师遗迹" },
    en: { line: "Inside \"{0}\" (a separate area, not on the surface)", name: "Illusionist's Ruins" },
};
// The labels the game left empty in most languages (only English and Simplified Chinese have them).
const LABEL_ZH = { UI_Map_21: "重要寶箱", UI_Map_22: "鑰匙", UI_Map_23: "龍柱", UI_Map_24: "大榕樹", UI_Map_25: "稻草人" };
const LABEL_EN = { UI_Map_21: "Major Chest", UI_Map_22: "Key", UI_Map_23: "Lóng Pillar", UI_Map_24: "Human-Faced Banyan", UI_Map_25: "Scarecrow" };
const FOCUS_LOCK = 2; // the map script's FocusItemType.Lock, which its own collectible icons use
// The fog check: each fog picture is read at FOG_CELL x FOG_CELL; an icon is under fog where its patch reads at least
// FOG_SHARE of that patch's strongest point, never more than FOG_MIN (tested on Pangzhen, whose clouds read 150-190
// inside) and never less than FOG_FLOOR. The ZDDY clouds are darker (peak near 150), so their cut is about 75.
const FOG_CELL = 64;
const FOG_MIN = 100;
const FOG_SHARE = 0.5;
const FOG_FLOOR = 40;
const FOG_LATE_MS = 5000; // how long a page built before its fog loaded keeps waiting for it
// the texture parameters of a fog material (the first one with a texture is its picture)
const FOG_TEX_GUESS = ["Texture", "Tex", "Mask", "MaskTex", "MaskTexture", "Fog", "FogTex", "FogTexture", "BaseTexture", "MainTex", "Diffuse", "Alpha", "Opacity"];

// ---- State ---------------------------------------------------------------------------------------------------------

const VIS = UE.ESlateVisibility;
const run = { stopped: false, path: undefined, readAt: -Infinity, made: false, said: new Set(), traced: 0, noKeys: false,
    shown: "", padSeen: new Set(), settings: { enable: true, fog: true, key: "h", pad: "gamepad_dpad_up", padName: "DPadUp" } };
const wrapped = []; // { proto, name, original, own, wrapper }
const HOOKS_KEY = "__mapCollectibleMarkersHooks";
const SESSION_KEY = "__mapCollectibleMarkersSession";
const hooks = {};
const maps = new Set(); // the map widgets this copy keeps a state on (map.__mcm); stop() cleans them
const pictures = new Map(); // picture path -> texture (null: failed to load)

// The Mods Menu page (optional): one row per setting, the same keys and defaults as DEFAULT_TEXT.
const page = () => ({ id: MOD_ID, title: MOD_NAME, version: MOD_VERSION, file: SETTINGS_FILE, store: "saved",
    description: "The region map shows the collectibles you have not picked up yet, with their names and where they come from.",
    settings: [
        { key: "Enable", type: "toggle", label: "Enable", default: true, help: "Off: the game's own map; the mod's icons go away." },
        { key: "HideUnderFog", type: "toggle", label: "Hide Under Fog", default: true,
            help: "On: no icons in areas still under fog, until you ring the bell that clears it. Takes effect the next time you open the map." },
        { key: "ToggleKey", type: "choice", label: "Hide/Show Key", default: "H", options: KEY_CHOICES.map((k) => ({ value: k, label: k })),
            help: "This key on the region map hides or shows the mod's icons (keyboard). Off: no key." },
        { key: "ControllerKey", type: "choice", label: "Hide/Show Button", default: "DPadUp",
            options: [...Object.keys(PAD_KEYS), "Off"].map((k) => ({ value: k, label: k })),
            help: "This controller button on the region map hides or shows the mod's icons. On the map it then does only this. Off: no button." },
    ],
    onChange: () => { run.readAt = -Infinity; } }); // read again at the next map frame
// PBZModLoader starts its mods after Mods Menu's, so a running Mods Menu has its registry object here by now. Without it
// nothing is pushed: an array left for a Mods Menu that starts later would give a page that saves another file.
const menu = { on: false };
{
    const mm = globalThis.PBZModsMenu;
    if (mm && typeof mm === "object" && !Array.isArray(mm) && typeof mm.push === "function"
        && typeof mm.settingsPath === "function" && mm.api && typeof mm.api.has === "function"
        && mm.api.has("settingsPath") && mm.api.has("store.saved")) {
        try {
            mm.push(page());
            menu.on = typeof mm.settingsPath(MOD_ID) === "string";
        }
        catch (e) {
            console.warn(`[${MOD_NAME}] no Mods Menu page: ${e}`);
        }
    }
}

// Lines for loader.log: note() always, trace() for events (capped), warnOnce() for a problem once per message.
const note = (message) => console.log(`[PBZMOD] [${MOD_NAME}] ${message}`);
function trace(message) {
    if (run.traced++ < TRACE_LINES)
        note(message);
}
function warnOnce(message) {
    if (run.said.has(message))
        return;
    run.said.add(message);
    console.warn(`[${MOD_NAME}] ${message}`);
}
// Puerts throws "passing a invalid object" for a wrapper of an object the game has freed: that is "not valid".
const valid = (o) => {
    if (!o)
        return false;
    try {
        return UE.KismetSystemLibrary.IsValid(o);
    }
    catch (e) {
        return false;
    }
};
// What holds until the game is closed, across Alt+F5: the ToggleKey choice, the icons' own visibility (to put back),
// and the map widgets the copy before this one took its icons off (this copy draws them again).
function session() {
    let s = globalThis[SESSION_KEY];
    if (!s || typeof s !== "object")
        s = globalThis[SESSION_KEY] = { hidden: false, shownVis: undefined, cleaned: undefined };
    return s;
}

// ---- Settings ------------------------------------------------------------------------------------------------------

// The settings file: the one Mods Menu's page saves, else the one next to this main.js.
function settingsPath() {
    if (menu.on) {
        const path = globalThis.PBZModsMenu.settingsPath(MOD_ID);
        if (typeof path === "string" && path)
            return path;
    }
    return UE.KismetSystemLibrary.ConvertToAbsolutePath(String(__dirname).replace(/[\\/]+$/, "") + "/" + SETTINGS_FILE);
}
// The value of `key` in the settings text, in lower case ("" when the key is missing).
function readKey(text, key) {
    const re = new RegExp("^[ \\t]*" + key + "[ \\t]*=[ \\t]*([^;#\\r\\n]*?)[ \\t]*(?:[;#][^\\r\\n]*)?$", "i");
    for (const line of text.split(/\r?\n/)) {
        const m = re.exec(line);
        if (m)
            return m[1].toLowerCase();
    }
    return "";
}
// The settings, read at most every SETTINGS_MS. A file that cannot be read keeps the last settings.
function settings() {
    if (Math.abs(Date.now() - run.readAt) < SETTINGS_MS)
        return run.settings;
    run.readAt = Date.now();
    try {
        run.path = run.path || settingsPath();
        let text = "";
        if (UE.BlueprintPathsLibrary.FileExists(run.path)) { // check first: EasyCsv logs an error for a missing file
            const out = puerts.$ref("");
            if (!UE.EasyCsv.LoadStringFromLocalFile(run.path, out))
                return run.settings; // locked mid-save: keep the last settings
            text = String(puerts.$unref(out)).replace(/^﻿/, "");
        }
        else if (!run.made) {
            run.made = true; // once a session, and never over an existing file
            UE.EasyCsv.SaveStringToFileWithFullPath(DEFAULT_TEXT, run.path);
        }
        const flag = (key, def) => {
            const v = readKey(text, key);
            return ["on", "1", "yes", "true"].includes(v) ? true : ["off", "0", "no", "false"].includes(v) ? false : def;
        };
        const off = (v) => ["off", "none", "0", "no", "false"].includes(v);
        const key = readKey(text, "ToggleKey");
        // ControllerKey: one of PAD_KEYS (any case), or an engine key name (Gamepad_...); anything else is off
        const pad = readKey(text, "ControllerKey");
        const padName = !pad ? "DPadUp" : off(pad) ? "" : Object.keys(PAD_KEYS).find((k) => k.toLowerCase() === pad)
            || (pad.startsWith("gamepad_") ? pad : "");
        if (pad && !off(pad) && !padName)
            warnOnce(`ControllerKey=${pad} is not a controller button (DPadUp, DPadDown, DPadLeft, DPadRight, L3, R3): no button`);
        run.settings = { enable: flag("Enable", true), fog: flag("HideUnderFog", true),
            key: !key ? "h" : off(key) ? "" : key,
            pad: String(PAD_KEYS[padName] || padName).toLowerCase(), padName };
        const shown = `Enable=${run.settings.enable ? "On" : "Off"} HideUnderFog=${run.settings.fog ? "On" : "Off"} ToggleKey=${run.settings.key.toUpperCase() || "Off"}`
            + ` ControllerKey=${padName || "Off"}`;
        if (shown !== run.shown) {
            run.shown = shown;
            trace("settings: " + shown);
        }
    }
    catch (e) {
        warnOnce(`settings not read: ${e}`);
    }
    return run.settings;
}
const keysOn = () => !run.noKeys && run.settings.enable && (!!run.settings.key || !!run.settings.pad);

// ---- Labels --------------------------------------------------------------------------------------------------------

function culture() {
    try {
        return String(UE.KismetInternationalizationLibrary.GetCurrentCulture() || "");
    }
    catch (e) {
        return "";
    }
}
const langSet = () => {
    const c = culture();
    return !c.startsWith("zh") ? "en" : /Hans|CN|SG/.test(c) ? "hans" : "hant";
};
const asString = (text) => {
    try {
        return String(UE.KismetTextLibrary.Conv_TextToString(text));
    }
    catch (e) {
        return "";
    }
};
// The game's text for a key; the labels the game left empty get LABEL_EN or LABEL_ZH.
function gameText(key) {
    const text = UIHelper.GetTextByID(key);
    if (!(key in LABEL_EN) || asString(text) !== "")
        return text;
    const s = (culture().startsWith("zh") ? LABEL_ZH : LABEL_EN)[key];
    return s ? cpp.FText.FromString(s) : text;
}
const gearLabel = (kind) => cpp.FText.FromString(GEAR_LABELS[langSet()][kind]);
// "Name ×2, Name ×4" for a material spot ("ItemID:amount|..."), names from the item table; undefined when a name cannot
// be read (the caller then uses the plain kind label)
function materialLabel(mats) {
    const parts = [];
    for (const m of String(mats).split("|")) {
        const [id, amount] = m.split(":");
        let name = "";
        try {
            const data = UE.PBZBackPackSubsystem.GetPropData(id);
            const key = data && data.ItemName ? data.ItemName.Key : "";
            if (key)
                name = asString(UIHelper.GetTextByID(key));
        }
        catch (e) {
        }
        if (!name || name == id)
            return undefined;
        parts.push(`${name} ×${amount}`);
    }
    return parts.length ? cpp.FText.FromString(parts.join(langSet() == "en" ? ", " : "、")) : undefined;
}
// How an entry of the map data is obtained (a SOURCE_TEXTS key, or "kind:textKey" from SOURCE_WHO; "" = unknown). Call
// readSource only on a GetRef'd entry, before any engine call (it reads names, no UFUNCTION).
const str = (v) => (v === undefined || v === null ? "" : v.toString());
function readSource(e) {
    const nodes = e.NodeGuids;
    const node = nodes && nodes.Num() > 0 ? str(nodes.Get(0)) : "";
    return { save: str(e.SaveGuidString), mob: str(e.MobDomainName), flow: str(e.FlowAssetName), node };
}
function sourceOf(s) {
    const has = (v) => v && v != "None";
    if (has(s.mob))
        return "mob";
    if (has(s.flow)) {
        if (SOURCE_WHO[s.flow])
            return SOURCE_WHO[s.flow];
        if (/MemoryFlower/i.test(`${s.flow} ${s.node}`))
            return "flower";
        if (/death|dead|_kill|die$|BenTi/i.test(s.flow)) // BenTi: the sect leader fight
            return "boss";
        if (/NPCSpawner/.test(s.node))
            return "npc";
        if (/FogDoor|SwitchDevice|Door/i.test(s.node))
            return "door";
        return "event";
    }
    if (/_Chest/i.test(s.save))
        return "chest";
    if (/Rubbish/i.test(s.save))
        return "breakable";
    return "";
}
function withSource(text, source) {
    if (!source)
        return text;
    const lang = langSet();
    const [kind, key] = source.split(":");
    let hint;
    if (key) {
        // the name in the game's language; an empty or missing row keeps the plain line
        let name = "";
        try {
            name = asString(UIHelper.GetTextByID(key));
        }
        catch (e) {
        }
        if (name && name != key)
            hint = SOURCE_NAMED[lang][kind].replace("{0}", name);
    }
    else if (SOURCE_NAMED[lang][kind] && !SOURCE_TEXTS[lang][kind]) {
        hint = SOURCE_NAMED[lang][kind];
    }
    if (!hint)
        hint = SOURCE_TEXTS[lang][kind];
    return hint ? cpp.FText.Format("{0}\n{1}", text, cpp.FText.FromString(hint)) : text;
}
// the "inside another area" line for items of OTHER_LEVEL_MAPS
function withOtherLevel(text, mapID) {
    const other = OTHER_LEVEL_MAPS[String(mapID).toLowerCase()];
    if (!other)
        return text;
    const t = OTHER_LEVEL_TEXTS[langSet()];
    let name = "";
    try {
        name = asString(UIHelper.GetTextByID(other.name));
    }
    catch (e) {
    }
    if (!name || name == other.name)
        name = t.name;
    return cpp.FText.Format("{0}\n{1}", text, cpp.FText.FromString(t.line.replace("{0}", name)));
}
const spotKey = (mapID, x, y, z) => `${mapID}:${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
// spot -> source of the shown map's Black Stone, Amber and keys
function sourcesCollect(map, ui) {
    const sources = new Map();
    const asset = ui.BP_MapItemDataAsset;
    if (!asset)
        return sources;
    for (const mapID of map.getallowedMapID() || []) {
        const sub = asset.MapItemDatas.GetRef(mapID);
        if (!sub)
            continue;
        for (const field of SOURCE_LISTS) {
            const arr = sub[field];
            const n = arr ? arr.Num() : 0;
            for (let i = 0; i < n; i++) {
                const e = arr.GetRef(i);
                if (!e)
                    continue;
                const source = sourceOf(readSource(e));
                const key = spotKey(String(mapID), e.Location.X, e.Location.Y, e.Location.Z);
                if (source && !sources.has(key))
                    sources.set(key, source);
            }
        }
    }
    return sources;
}
// a game icon's label with the source line and the "inside another area" line
function sourceText(s, text, mapID, location) {
    try {
        const source = s.sources && s.sources.get(spotKey(String(mapID), location.X, location.Y, location.Z));
        return withOtherLevel(withSource(text, source), mapID);
    }
    catch (e) {
        return text;
    }
}

// ---- Gear and material spots ---------------------------------------------------------------------------------------

// The not yet owned weapons, shadow weapons, accessories and medicines, the bells not rung yet and the material spots
// not yet broken or opened of the shown map: { MapID, Location, Label, Tint, Picture }.
function gearCollect(map, ui) {
    const items = [];
    const asset = ui.BP_MapItemDataAsset;
    const backPack = Ts.getWorldSubsystem(map, UE.PBZBackPackSubsystem.StaticClass());
    const gameSystem = Ts.getWorldSubsystem(map, UE.PBZGameSystem.StaticClass());
    const mapIDs = map.getallowedMapID() || [];
    if (!asset || !backPack)
        return items;
    const cycle = gameSystem ? gameSystem.GetCycleCount() : 0;
    const bellManager = Ts.getWorldSubsystem(map, UE.BellManager.StaticClass());
    const rung = bellManager ? bellManager.GetAllActivateBellIDs() : undefined;
    // 1. copy the entries out as plain values (no engine calls while holding struct refs, the game's own rule for these
    //    lists)
    const found = [];
    for (const mapID of mapIDs) {
        const sub = asset.MapItemDatas.GetRef(mapID);
        if (!sub)
            continue;
        for (const [kind, field, idField, owned, tint, picture] of GEAR) {
            const arr = sub[field];
            const n = arr ? arr.Num() : 0;
            for (let i = 0; i < n; i++) {
                const e = arr.GetRef(i);
                if (!e)
                    continue;
                found.push({ kind, owned, tint, picture, mapID: String(mapID), id: e[idField].toString(),
                    X: e.Location.X, Y: e.Location.Y, Z: e.Location.Z, source: kind == "Bell" ? "" : sourceOf(readSource(e)) });
            }
        }
    }
    const levelActors = Ts.getWorldSubsystem(map, UE.PBZLevelActorManager.StaticClass());
    if (levelActors && typeof levelActors.HasSaveDataByActorID === "function") {
        // the game hands out map IDs in lower case (FName); the spot list has them as written in the data
        const want = new Map(mapIDs.map((m) => [String(m).toLowerCase(), String(m)]));
        for (const s of MATERIAL_SPOTS) {
            const mapID = want.get(s[0].toLowerCase());
            if (mapID)
                found.push({ kind: "Material", tint: MATERIAL_TINT, picture: MATERIAL_PIC, mapID, id: s[1],
                    X: s[2], Y: s[3], Z: s[4], mats: s[5], source: s[6] == "c" ? "chest" : "breakable" });
        }
    }
    const chests = [];
    const prim = ui.DisplayPrimaryData;
    for (let i = 0; prim && i < prim.Num(); i++) {
        const p = prim.Get(i);
        chests.push([String(p.MapID), p.Location.X, p.Location.Y, p.Location.Z]);
    }
    const inChest = (f) => chests.some((c) => c[0] == f.mapID && Math.hypot(c[1] - f.X, c[2] - f.Y, c[3] - f.Z) < GEAR_SAME_SPOT);
    // story-gated material spots: shown only while their story tag is set (checked once per tag)
    let epm;
    try {
        epm = Ts.getWorldSubsystem(map, UE.EventPipelineManager.StaticClass());
    }
    catch (e) {
    }
    const tagOn = new Map();
    const storyOk = (actorKey) => {
        const tag = MATERIAL_TAG_OF.get(actorKey);
        if (!tag)
            return true;
        if (!tagOn.has(tag)) {
            let on = true; // unreadable: show it
            try {
                if (epm)
                    on = epm.HasTagWithOutSource(Ts.constructGameplayTag(tag)) !== false;
            }
            catch (e) {
            }
            tagOn.set(tag, on);
        }
        return tagOn.get(tag);
    };
    // 2. keep the ones not owned yet, not in a chest that has its own icon, once per spot
    const seen = new Set();
    for (const f of found) {
        if (!f.id || f.id == "None" || (!f.X && !f.Y && !f.Z))
            continue;
        const key = `${f.kind}:${f.id}:${Math.round(f.X / 10)},${Math.round(f.Y / 10)},${Math.round(f.Z / 10)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        if (f.kind == "Bell") {
            // rung bells are on the map already (the game's own bell icons)
            if (!rung || rung.Contains(f.id) || f.id.toLowerCase() == HIDDEN_BELL)
                continue;
        }
        else if (f.kind == "Material") {
            if (levelActors.HasSaveDataByActorID(f.id) || !storyOk(f.id) || inChest(f))
                continue;
        }
        else {
            const info = backPack[f.owned].Get(f.id);
            if (info && info.AcquiredCycle == cycle)
                continue; // a new game+: owned from an earlier playthrough counts as not collected (the game's rule)
            if (inChest(f))
                continue;
        }
        let label;
        try {
            if (f.kind == "Material")
                label = materialLabel(f.mats);
            else if (f.kind == "Bell") {
                // read the key right away: the struct GetBellData returns is reused by the next call
                const key = UE.BellManager.GetBellData(f.id).BellName.Key;
                if (key)
                    label = UIHelper.GetTextByID(key);
            }
            const data = f.kind == "Bell" || f.kind == "Material" ? undefined
                : f.kind == "Weapon" ? backPack.GetMainWeaponTableData(f.id).WeaponName
                    : f.kind == "ShaChi" ? backPack.GetShaqiWeaponTableData(f.id).WeaponName
                        : f.kind == "Accessory" ? UE.PBZBackPackSubsystem.GetAccessoryData(f.id).AccessoryName
                            : UE.PBZBackPackSubsystem.GetMedicineData(f.id).Name;
            if (data && data.Key)
                label = UE.PBZBlueprintFunctionLibrary.MakeTextByKey(data.Key);
        }
        catch (e) {
        }
        if (!label || asString(label) == "")
            label = gearLabel(f.kind);
        try {
            label = withOtherLevel(withSource(label, f.source), f.mapID);
        }
        catch (e) {
        }
        items.push({ kind: f.kind, MapID: f.mapID, Location: new UE.Vector(f.X, f.Y, f.Z), Label: label, Tint: f.tint, Picture: f.picture });
    }
    return items;
}
// The "Collection details" panel's pictures (small UI textures, normally loaded by that panel already); a picture that
// fails to load keeps the chest picture.
function picture(path) {
    let tex = pictures.get(path);
    if (tex === null || valid(tex))
        return tex;
    tex = null;
    try {
        tex = UE.Texture2D.Load(path) || null;
    }
    catch (e) {
        warnOnce(`picture ${path}: ${e}`);
    }
    pictures.set(path, tex);
    return tex;
}

// ---- Fog -----------------------------------------------------------------------------------------------------------

// Is an icon in an area still under fog? The game's own test hides an icon when it is inside the rectangle of any fog
// patch it thinks is still there. But the patches are soft cloud pictures much smaller than their rectangles, which
// overlap their neighbours a lot, and the game's list of cleared patches is only filled during the fog animation. Here
// "cleared" comes from the save (MapSubsystem.GetUnLockMaskIDs), and an icon is under fog when a still-fogged patch's
// picture is drawn over it (fogPaint). If the pictures cannot be read: the patch whose centre is nearest decides.
function fogPrepare(map, s) {
    s.fog = undefined;
    s.fogPix = undefined;
    const maskWidget = map.MaskWidgetInstance;
    if (!valid(maskWidget))
        return; // fog not loaded yet: hide nothing, like the game
    const cleared = new Set();
    const ms = Ts.getWorldSubsystem(map, UE.MapSubsystem.StaticClass());
    if (ms) {
        for (const mapID of map.getallowedMapID() || []) {
            const ids = ms.GetUnLockMaskIDs(mapID, 0);
            for (let i = 0; ids && i < ids.Num(); i++)
                cleared.add(String(ids.Get(i)));
        }
    }
    if (typeof map.UpdateMaskWidget === "function")
        map.UpdateMaskWidget();
    const ref = puerts.$ref(undefined);
    maskWidget.GetMaskMap(ref);
    const maskMap = puerts.$unref(ref);
    if (!maskMap)
        return;
    const validIds = map.allValidMaskIDs;
    const hidden = [VIS.Hidden, VIS.Collapsed];
    const fog = [];
    const maxIdx = maskMap.GetMaxIndex();
    for (let i = 0; i < maxIdx; i++) {
        if (!maskMap.IsValidIndex(i))
            continue;
        const maskID = maskMap.GetKey(i);
        const id = String(maskID);
        if (validIds && !validIds.has(id))
            continue; // the game ignores these too
        const img = maskMap.Get(maskID);
        if (!img)
            continue;
        const isCleared = cleared.has(id) || (map.MapUnLockMasks && map.MapUnLockMasks.Contains(maskID)) ||
            (map.fadeWidgets && map.fadeWidgets.includes(img)) ||
            hidden.includes(img.GetVisibility()) || img.GetRenderOpacity() == 0;
        const slot = UE.WidgetLayoutLibrary.SlotAsCanvasSlot(img);
        const pos = slot.GetPosition();
        const size = slot.GetSize();
        // the rectangle as the game sees it (position = centre) and as drawn (slot alignment)
        const align = typeof slot.GetAlignment == "function" ? slot.GetAlignment() : { X: 0.5, Y: 0.5 };
        fog.push({ x: pos.X, y: pos.Y, hw: size.X / 2, hh: size.Y / 2, cleared: isCleared, id, img,
            left: pos.X - align.X * size.X, top: pos.Y - align.Y * size.Y, w: size.X, h: size.Y });
    }
    s.fog = fog;
    try {
        fogPaint(map, s, fog);
    }
    catch (e) {
        s.fogPix = undefined;
        warnOnce(`fog pictures not read: ${e}`);
    }
}
// the texture parameters of a fog material (the game's fog materials call their picture MapAreaMask)
function fogTextures(mat) {
    const found = [];
    try {
        const tp = mat.TextureParameterValues;
        for (let i = 0; tp && i < tp.Num(); i++) {
            const e = tp.Get(i);
            found.push({ name: String(e.ParameterInfo.Name), tex: e.ParameterValue });
        }
    }
    catch (e) {
    }
    found.sort((a, b) => (b.name == "MapAreaMask") - (a.name == "MapAreaMask"));
    if (!found.some((t) => t.tex)) {
        for (const name of FOG_TEX_GUESS) {
            try {
                const tex = mat.K2_GetTextureParameterValue(name);
                if (tex)
                    found.push({ name: "?" + name, tex });
            }
            catch (e) {
            }
        }
    }
    return found;
}
// The fog patches are soft-edged pictures, and their rectangles overlap a lot. Draw the pictures of the patches still
// fogged into a small offscreen texture (one cell each) and read it back, so an icon can be checked against the fog
// actually drawn over it.
function fogPaint(map, s, fog) {
    s.fogPix = undefined;
    const KRL = UE.KismetRenderingLibrary;
    const isA = (obj, cls) => UE.KismetMathLibrary.ClassIsChildOf(obj.GetClass(), cls.StaticClass());
    const list = [];
    for (const m of fog) {
        if (m.cleared)
            continue;
        const brush = m.img.Brush;
        let res = brush && brush.ResourceObject;
        m.kind = !res ? "none" : isA(res, UE.Texture) ? "tex" : isA(res, UE.MaterialInterface) ? "mat" : "other";
        // a fog patch drawn with a material: draw its picture (texture parameter) instead
        if (m.kind == "mat") {
            const t = fogTextures(res).find((x) => x.tex);
            if (t) {
                m.kind = "tex";
                res = t.tex;
            }
        }
        if (m.kind == "tex" || m.kind == "mat") {
            m.res = res;
            m.cell = list.length;
            list.push(m);
        }
    }
    if (!list.length)
        return;
    const cols = 8, W = cols * FOG_CELL, H = Math.ceil(list.length / cols) * FOG_CELL;
    let rt = s.fogRT;
    if (!valid(rt) || rt.SizeX != W || rt.SizeY != H)
        rt = s.fogRT = KRL.CreateRenderTarget2D(map, W, H, UE.ETextureRenderTargetFormat.RTF_RGBA8, new UE.LinearColor(0, 0, 0, 1), false);
    KRL.ClearRenderTarget2D(map, rt, new UE.LinearColor(0, 0, 0, 1));
    const canvasRef = puerts.$ref(undefined);
    const sizeRef = puerts.$ref(new UE.Vector2D(0, 0));
    const ctxRef = puerts.$ref(new UE.DrawToRenderTargetContext());
    KRL.BeginDrawCanvasToRenderTarget(map, rt, canvasRef, sizeRef, ctxRef);
    try {
        const canvas = puerts.$unref(canvasRef);
        const white = new UE.LinearColor(1, 1, 1, 1);
        const zero = new UE.Vector2D(0, 0), one = new UE.Vector2D(1, 1), mid = new UE.Vector2D(0.5, 0.5);
        const size = new UE.Vector2D(FOG_CELL, FOG_CELL);
        for (const m of list) {
            const at = new UE.Vector2D((m.cell % cols) * FOG_CELL, Math.floor(m.cell / cols) * FOG_CELL);
            if (m.kind == "tex")
                canvas.K2_DrawTexture(m.res, at, size, zero, one, white, UE.EBlendMode.BLEND_Translucent, 0, mid);
            else
                canvas.K2_DrawMaterial(m.res, at, size, zero, one, 0, mid);
        }
    }
    finally {
        KRL.EndDrawCanvasToRenderTarget(map, puerts.$unref(ctxRef));
    }
    // read it all at once if possible, else pixel by pixel when asked
    let read, all = false;
    try {
        const arr0 = UE.NewArray(UE.Color);
        const outRef = puerts.$ref(arr0);
        if (KRL.ReadRenderTarget(map, rt, outRef, false)) {
            const arr = puerts.$unref(outRef) || arr0;
            if (arr.Num() == W * H) {
                read = (x, y) => arr.Get(y * W + x);
                all = true;
            }
        }
    }
    catch (e) {
    }
    if (!read)
        read = (x, y) => KRL.ReadRenderTargetPixel(map, rt, x, y);
    s.fogPix = { cols, read };
    // each patch's strongest fog: the pictures of some maps are much darker than others, so an icon is compared with its
    // own patch (FOG_SHARE of that)
    const step = all ? 2 : 8;
    for (const m of list) {
        const x0 = (m.cell % cols) * FOG_CELL, y0 = Math.floor(m.cell / cols) * FOG_CELL;
        let most = 0;
        for (let y = 0; y < FOG_CELL; y += step)
            for (let x = 0; x < FOG_CELL; x += step)
                most = Math.max(most, fogStrength(m, read(x0 + x, y0 + y)));
        m.most = most;
    }
}
// A picture drawn as a texture shows its cloud in colour; a patch drawn as a material (no picture found) comes out almost
// black and shows its cloud as missing alpha.
const fogStrength = (m, c) => (m.kind == "mat" ? 255 - c.A : Math.max(c.R, c.G, c.B));
// how much fog the patch's picture draws at (u, v) inside its rectangle, 0..255
function fogValue(s, m, u, v) {
    const pix = s.fogPix;
    const x = (m.cell % pix.cols) * FOG_CELL + Math.min(FOG_CELL - 1, Math.floor(u * FOG_CELL));
    const y = Math.floor(m.cell / pix.cols) * FOG_CELL + Math.min(FOG_CELL - 1, Math.floor(v * FOG_CELL));
    return fogStrength(m, pix.read(x, y));
}
function fogCovered(s, p) {
    const fog = s.fog;
    if (!fog)
        return false;
    if (s.fogPix) {
        for (const m of fog) {
            if (m.cleared || m.cell === undefined)
                continue;
            const u = (p.X - m.left) / m.w, v = (p.Y - m.top) / m.h;
            if (!(u >= 0 && u < 1 && v >= 0 && v < 1))
                continue;
            const min = Math.max(FOG_FLOOR, Math.min(FOG_MIN, Math.round((m.most || 0) * FOG_SHARE)));
            if (fogValue(s, m, u, v) >= min)
                return true;
        }
        return false;
    }
    // the patch whose centre is nearest (relative to its size) decides
    let best, bestD = Infinity;
    for (const m of fog) {
        const dx = (p.X - m.x) / m.hw, dy = (p.Y - m.y) / m.hh;
        if (!(Math.abs(dx) <= 1 && Math.abs(dy) <= 1))
            continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
            bestD = d;
            best = m;
        }
    }
    return !!best && !best.cleared;
}
// The fog loaded after the icons were drawn: hide the ones under it now. false = no fog yet.
function fogLateCheck(map, s) {
    fogPrepare(map, s);
    if (!s.fog || !s.fog.length)
        return false;
    const late = new Set();
    for (const w of s.widgets) {
        if (valid(w) && fogCovered(s, UE.WidgetLayoutLibrary.SlotAsCanvasSlot(w).GetPosition()))
            late.add(w);
    }
    s.fogLate = late;
    applyHidden(map, s);
    dropHiddenSelection(map, s);
    if (late.size)
        trace(`the fog loaded late: ${late.size} icons under it hidden`);
    return true;
}

// ---- The icons -----------------------------------------------------------------------------------------------------

// The mod's state on a map widget (map.__mcm); a state an earlier copy left is replaced.
function stateOf(map) {
    let s = map.__mcm;
    if (!s || s.owner !== run) {
        s = map.__mcm = { owner: run, widgets: [], keys: [], fresh: false, timer: undefined, enabled: undefined,
            hiddenSet: undefined, fogLate: undefined, fog: undefined, fogPix: undefined, fogRT: undefined, fogOn: false,
            fogPendingUntil: 0, fogMaskSeen: false, sources: undefined, offMap: 0, lastTick: 0, focusAt: 0,
            mtpOpen: false, switchAt: 0 };
        maps.add(map);
    }
    return s;
}
// One icon on the region map, placed as the map script places its own collectible icons (Map.js initAdvancedSlot_*).
// A spot the map cannot place comes back as 0,0 and would sit in the top-left corner: skipped (the game's own quest
// markers skip those too). icon: { cls, mapID, location, key, size, z, label(), challenge? }.
function place(map, s, icon) {
    const at = map.ConvertWorldLocationToScreen(icon.location, icon.mapID);
    if (!at || (at.X == 0 && at.Y == 0)) {
        s.offMap++;
        return undefined;
    }
    if (s.fogOn && fogCovered(s, at))
        return undefined;
    const w = map.CreateWidget(icon.cls, icon.location);
    if (!w)
        return undefined;
    map.applyRenderScale(w, 1.0); // a pooled widget: clear a selection's 1.28 left over
    if (icon.challenge !== undefined)
        w.ChallengeType = icon.challenge;
    w.OwnMapID = icon.mapID;
    w.InitWidget(icon.label(), icon.key);
    map.SlotWidgetGroup.AddWidget(w);
    const key = icon.key.toLocaleLowerCase();
    map.focusItemMap.set(key, { widget: w, useAreaData: 0, itemType: FOCUS_LOCK, mapID: icon.mapID });
    map.Gadget.AddChild(w);
    map.AdvancedSlots.Add(w);
    s.widgets.push(w);
    s.keys.push(key);
    const slot = UE.WidgetLayoutLibrary.SlotAsCanvasSlot(w);
    slot.SetSize(icon.size);
    slot.SetAlignment(new UE.Vector2D(0.5, 0.5));
    slot.SetZOrder(icon.z);
    slot.SetPosition(at);
    return w;
}
// The picture SCALE times bigger than its slot; Memory Flowers blue; gear and material spots tinted, with the
// "Collection details" picture of their kind.
function dress(w, tint, path) {
    const img = w.Image_29;
    if (!img)
        return;
    img.SetRenderScale(new UE.Vector2D(SCALE, SCALE));
    if (tint)
        img.SetColorAndOpacity(new UE.LinearColor(tint[0], tint[1], tint[2], 1));
    const pic = path ? picture(path) : null;
    if (pic) {
        img.SetBrushFromTexture(pic, false);
        img.SetRenderScale(new UE.Vector2D(GEAR_PIC_SCALE, GEAR_PIC_SCALE));
    }
}
// The six kinds the map script would draw (Map.js initAdvancedSlot_*): the W_MapItemCompletionUI list, the map's widget
// class, the icon key, the label, the size and the z-order the game gives them.
function gameKinds(map, ui) {
    const advanced = map.IconSizeAdvancedSlot;
    const itemName = (id) => {
        const data = UE.PBZBackPackSubsystem.GetPropData(id);
        return data && data.ItemName ? data.ItemName.Key : "";
    };
    let challengeKeys = new Map();
    try {
        const E = UE.Game.PBZContent.Blueprint.Enum.E_ChallengeType.E_ChallengeType;
        challengeKeys = new Map([[E.DaoCaoren, "UI_Map_25"], [E.LongZhu, "UI_Map_23"], [E.RongShuZhiXin, "UI_Map_24"]]);
    }
    catch (e) {
        warnOnce(`challenge types: ${e}`);
    }
    return [
        { name: "HeiShi", list: ui.DisplayHeishiData, cls: map.AdvancedSlotClass_HeiShi, size: advanced, z: 4,
            key: (e, i) => "Heishi" + i, text: () => itemName("Item_Piece_001") },
        { name: "HuPo", list: ui.DisplayHupoData, cls: map.AdvancedSlotClass_Hupo, size: advanced, z: 4,
            key: (e, i) => "HuPo" + i, text: () => itemName("Item_Piece_002") },
        { name: "Flower", list: ui.DisplayFlowerData, cls: map.AdvancedSlotClass_Flower, size: advanced, z: 4,
            key: (e, i) => "Flower" + i, text: () => "UI_Map_20", tint: FLOWER_TINT },
        // the list has a chest once per item inside: one icon per chest
        { name: "PrimaryItem", list: ui.DisplayPrimaryData, cls: map.AdvancedSlotClass_PrimaryItem, size: advanced, z: 4,
            key: (e, i) => "primarydata" + i, text: () => "UI_Map_21", oncePerSpot: true },
        { name: "YaoShi", list: ui.DisplayYaoShiData, cls: map.AdvancedSlotClass_YaoshiItem, size: map.IconSizeKey, z: 11,
            key: (e, i) => e.MapID + "yaoshidata" + i, text: () => "UI_Map_22" },
        { name: "Challenge", list: ui.DisplayChallengeDatas, cls: map.AdvancedSlotClass_Challenge, size: advanced, z: 11,
            key: (e, i) => `${e.MapID}challengeType${i}`, text: (e) => challengeKeys.get(e.ChallengeType) || "UI_Map_23", challenge: true },
    ];
}
// Draws the mod's icons on the shown region map (only after the completion lists were rebuilt for it).
function build(map, s) {
    const set = settings();
    s.enabled = set.enable;
    if (!set.enable || !s.fresh || map.BigMapMode || !valid(map.W_MapItemCompletionUI))
        return;
    const ui = map.W_MapItemCompletionUI;
    s.offMap = 0;
    try {
        s.sources = sourcesCollect(map, ui);
    }
    catch (e) {
        s.sources = undefined;
        warnOnce(`sources not read: ${e}`);
    }
    s.fogOn = set.fog;
    s.fog = undefined;
    s.fogPix = undefined;
    s.fogPendingUntil = 0;
    if (s.fogOn) {
        try {
            fogPrepare(map, s);
        }
        catch (e) {
            s.fog = undefined;
            s.fogPix = undefined;
            warnOnce(`fog not read: ${e}`);
        }
        // a page opened from the world map is built before its fog has loaded: check the icons again once it is there
        // (Tick), for a few seconds at most
        s.fogPendingUntil = s.fog && s.fog.length ? 0 : Date.now() + FOG_LATE_MS;
        s.fogMaskSeen = false;
    }
    const counts = [];
    const textCache = new Map();
    for (const kind of gameKinds(map, ui)) {
        const before = s.widgets.length;
        try {
            const list = kind.list;
            const spots = new Set();
            for (let i = 0; list && i < list.Num(); i++) {
                const e = list.Get(i);
                const mapID = e.MapID;
                const location = e.Location;
                if (kind.oncePerSpot) {
                    const at = spotKey(mapID, location.X, location.Y, location.Z);
                    if (spots.has(at))
                        continue;
                    spots.add(at);
                }
                const textKey = kind.text(e);
                const w = place(map, s, { cls: kind.cls, mapID, location, key: kind.key(e, i), size: kind.size, z: kind.z,
                    challenge: kind.challenge ? e.ChallengeType : undefined,
                    label: () => {
                        if (!textCache.has(textKey))
                            textCache.set(textKey, gameText(textKey));
                        return sourceText(s, textCache.get(textKey), mapID, location);
                    } });
                if (w)
                    dress(w, kind.tint);
            }
        }
        catch (e) {
            warnOnce(`${kind.name} not drawn: ${e}`);
        }
        counts.push(`${kind.name}=${s.widgets.length - before}`);
    }
    const before = s.widgets.length;
    try {
        const gear = gearCollect(map, ui);
        for (let i = 0; i < gear.length; i++) {
            const item = gear[i];
            const w = place(map, s, { cls: map.AdvancedSlotClass_PrimaryItem, mapID: item.MapID, location: item.Location,
                key: "pbzgear" + i, size: map.IconSizeAdvancedSlot, z: 4, label: () => item.Label });
            if (w)
                dress(w, item.Tint, item.Picture);
        }
    }
    catch (e) {
        warnOnce(`gear not drawn: ${e}`);
    }
    counts.push(`Gear=${s.widgets.length - before}`);
    let ids = "";
    try {
        ids = (map.getallowedMapID() || []).join(",");
    }
    catch (e) {
    }
    trace(`region map ${ids}: ${counts.join(" ")}` + (s.offMap ? ` off-map=${s.offMap}` : "")
        + (s.fogOn ? (s.fog ? ` fog=${s.fog.filter((m) => !m.cleared).length}/${s.fog.length}${s.fogPix ? "" : " (rectangles)"}` : " fog=later") : " fog=off"));
}
// The game's slots were rebuilt (all of AdvancedSlots removed): the mod's icons again. Never lets an error out: on the
// first open an error here stops the map's frame-split build, its fade-in never plays and the page stays black.
function markersInit(map) {
    try {
        const s = stateOf(map);
        s.widgets = [];
        s.keys = [];
        s.fogLate = undefined;
        try {
            build(map, s);
        }
        catch (e) {
            warnOnce(`icons not drawn: ${e}`);
        }
        try {
            applyHidden(map, s);
        }
        catch (e) {
            warnOnce(`hide: ${e}`);
        }
    }
    catch (e) {
        warnOnce(`icons: ${e}`);
    }
}
// Runs after the game's own setTimeout(0) in InitMapText that rebuilds the lists.
function afterLists(map, tries) {
    const s = stateOf(map);
    if (s.timer)
        clearTimeout(s.timer);
    s.timer = setTimeout(() => {
        s.timer = undefined;
        if (run.stopped || map.__mcm !== s)
            return;
        try {
            if (map.initCompletionTimer) {
                if (tries < 10)
                    afterLists(map, tries + 1);
                return;
            }
            s.fresh = true;
            // first open: the frame-split build adds them next frame. Touch nothing else here: reading
            // W_MapItemCompletionUI in this frame (right after the game's own timer set it up) stopped the map widget's
            // Tick, the build never finished and the map froze with no icons (the source mod's finding).
            if (map.pendingInitSlice || map.BigMapMode)
                return;
            if (!s.widgets.length) {
                markersInit(map);
                const size = map.IconSizePortal.op_Multiply(map.getElementZoomScale());
                for (const w of s.widgets)
                    UE.WidgetLayoutLibrary.SlotAsCanvasSlot(w).SetSize(size);
            }
        }
        catch (e) {
            warnOnce(`refresh failed: ${e}`);
        }
    }, 0);
}

// ---- Hide and show -------------------------------------------------------------------------------------------------

// ToggleKey and Enable=Off hide the icons; icons found under fog after they were drawn stay hidden either way. Hidden
// icons are collapsed and left out of the hover and gamepad pick (getFocusCandidatesSorted and iconCenterByID).
function applyHidden(map, s) {
    const sess = session();
    const hide = sess.hidden || !run.settings.enable;
    const collapsed = VIS.Collapsed;
    const late = s.fogLate;
    s.hiddenSet = hide ? new Set(s.widgets) : late && late.size ? new Set(late) : undefined;
    for (const w of s.widgets) {
        if (!valid(w))
            continue;
        const vis = w.GetVisibility();
        // the icon's own visibility, to put back (pooled widgets come back as they were left)
        if (vis !== collapsed && sess.shownVis === undefined)
            sess.shownVis = vis;
        if (hide || (late && late.has(w)))
            w.SetVisibility(collapsed);
        else if (vis === collapsed)
            w.SetVisibility(sess.shownVis !== undefined ? sess.shownVis : VIS.SelfHitTestInvisible);
    }
}
function isHidden(map, s, key) {
    const set = s.hiddenSet;
    if (!set || !key || !map.focusItemMap)
        return false;
    const v = map.focusItemMap.get(String(key).toLocaleLowerCase());
    return !!v && set.has(v.widget);
}
// drop the selection (and its label) if it is on one of the hidden icons
function dropHiddenSelection(map, s) {
    if (!s.hiddenSet)
        return;
    try {
        const group = map.SlotWidgetGroup;
        const sel = group && typeof group.GetSelectedButtonBase == "function" ? group.GetSelectedButtonBase() : undefined;
        if (sel && s.hiddenSet.has(sel))
            group.ClearSelection();
    }
    catch (e) {
        warnOnce(`selection: ${e}`);
    }
    if (isHidden(map, s, map.cursorFocusedIconID))
        map.cursorFocusedIconID = "";
    if (isHidden(map, s, map.lastSnappedIconID))
        map.lastSnappedIconID = "";
}
function toggleIcons(map, name) {
    const sess = session();
    sess.hidden = !sess.hidden;
    const s = stateOf(map);
    applyHidden(map, s);
    if (sess.hidden)
        dropHiddenSelection(map, s);
    trace(`icons ${sess.hidden ? "hidden" : "shown"} (${name})`);
}
// The map page never takes keyboard focus (the system menu keeps it), so its key events never fire. Each time the page
// shows (Tick starts again after a pause) it takes focus once, a moment later; the menu's own keys (Q, E, Esc) are bound
// actions and still work. Not on the map opened at a bell (it has its own bell list).
function takeFocus(map) {
    if (!keysOn())
        return;
    if (typeof map.IsOpenByBell === "function" && map.IsOpenByBell())
        return;
    if (map.HasAnyUserFocus() || map.HasFocusedDescendants())
        return;
    if (typeof map.SetIsFocusable === "function")
        map.SetIsFocusable(true);
    else
        map.bIsFocusable = true;
    map.SetFocus();
}
// ToggleKey and ControllerKey (hide or show) and Tab (world map). true when the key was used.
function handleKey(map, event) {
    const name = String(UE.KismetInputLibrary.GetKey(event).KeyName);
    const key = name.toLowerCase();
    // which controller buttons reach the map page (each once in the log)
    if (key.startsWith("gamepad_") && !run.padSeen.has(key)) {
        run.padSeen.add(key);
        trace(`controller button on the map: ${name}`);
    }
    const isToggle = keysOn() && (key === run.settings.key || key === run.settings.pad);
    const isSwitch = key === "tab" && typeof map.switchMap === "function" &&
        !(typeof map.IsOpenByBell === "function" && map.IsOpenByBell()) &&
        !(typeof map.isOpenCompletion === "function" && map.W_MapItemCompletionUI && map.isOpenCompletion());
    if (!isToggle && !isSwitch)
        return false;
    let repeat = false;
    try {
        repeat = UE.KismetInputLibrary.InputEvent_IsRepeat(event);
    }
    catch (e) {
    }
    if (!repeat) {
        if (isToggle)
            toggleIcons(map, name);
        else
            map.switchMap();
    }
    return true;
}
// One region map frame (from the wrapped Tick).
function tick(map) {
    const set = settings();
    const s = stateOf(map);
    const now = Date.now();
    // the copy before this one took its icons off this map (Alt+F5 while it showed): draw them again
    const sess = session();
    if (sess.cleaned && sess.cleaned.delete(map) && !s.timer && !s.widgets.length)
        afterLists(map, 0);
    // Enable switched (live): hide the icons at once, or show them again (draw them when there are none)
    if (s.enabled === undefined)
        s.enabled = set.enable;
    else if (s.enabled !== set.enable) {
        s.enabled = set.enable;
        applyHidden(map, s);
        dropHiddenSelection(map, s);
        if (set.enable && !s.widgets.length && !s.timer)
            afterLists(map, 0);
    }
    if (!s.lastTick || now - s.lastTick > 300)
        s.focusAt = now + 250;
    s.lastTick = now;
    // Map Tracker Plus hands focus back to the menu when its filter panel closes: take it again a moment later
    const mtpOpen = !!(map.__pbzTrackerControls && map.__pbzTrackerControls.open);
    if (s.mtpOpen && !mtpOpen)
        s.focusAt = now + 250;
    s.mtpOpen = mtpOpen;
    if (s.focusAt && now >= s.focusAt) {
        s.focusAt = 0;
        takeFocus(map);
    }
    if (s.fogPendingUntil) {
        if (now > s.fogPendingUntil || map.BigMapMode)
            s.fogPendingUntil = 0;
        else if (valid(map.MaskWidgetInstance)) {
            // give the fog widget one frame to lay out its patches
            if (s.fogMaskSeen && fogLateCheck(map, s))
                s.fogPendingUntil = 0;
            s.fogMaskSeen = true;
        }
    }
}

// ---- The wrapped map methods ---------------------------------------------------------------------------------------

function onMapText(original, args) {
    let s;
    try {
        // the lists are about to be rebuilt for the shown map: do not draw the old ones
        s = stateOf(this);
        s.fresh = false;
        if (s.timer) {
            clearTimeout(s.timer);
            s.timer = undefined;
        }
        const sess = session();
        if (sess.cleaned)
            sess.cleaned.delete(this);
    }
    catch (e) {
        warnOnce(`map text: ${e}`);
    }
    const result = original.apply(this, args);
    if (s) {
        try {
            afterLists(this, 0);
        }
        catch (e) {
            warnOnce(`map text: ${e}`);
        }
    }
    return result;
}
function onSlotWidget(original, args) {
    const result = original.apply(this, args);
    markersInit(this);
    return result;
}
function onCandidates(original, args) {
    const list = original.apply(this, args);
    try {
        const s = this.__mcm;
        if (!s || s.owner !== run || !s.hiddenSet || !Array.isArray(list))
            return list;
        return list.filter((c) => !isHidden(this, s, c.key));
    }
    catch (e) {
        warnOnce(`pick: ${e}`);
        return list;
    }
}
function onIconCenter(original, args) {
    try {
        const s = this.__mcm;
        if (s && s.owner === run && isHidden(this, s, args[0]))
            return undefined;
    }
    catch (e) {
        warnOnce(`pick: ${e}`);
    }
    return original.apply(this, args);
}
function onTick(original, args) {
    try {
        tick(this);
    }
    catch (e) {
        warnOnce(`tick: ${e}`);
    }
    return original.apply(this, args);
}
function onSwitchMap(original, args) {
    if (keysOn()) {
        const s = stateOf(this);
        const now = Date.now();
        if (s.switchAt && now - s.switchAt < 250)
            return undefined;
        s.switchAt = now;
    }
    return original.apply(this, args);
}
function onPreviewKey(original, args) {
    try {
        if (handleKey(this, args[1]))
            return UE.WidgetBlueprintLibrary.Handled();
    }
    catch (e) {
        warnOnce(`key: ${e}`);
    }
    return original ? original.apply(this, args) : UE.WidgetBlueprintLibrary.Unhandled();
}

// ---- Start and stop ------------------------------------------------------------------------------------------------

// Wraps a method of the game's map class; stop() puts the original back (or removes the method the mod added). Each
// wrapper looks up its replacement in globalThis[HOOKS_KEY] at call time; with none it runs the game's own method, or
// `fallback` for a method the map script does not have.
function wrap(proto, name, replacement, fallback) {
    const original = proto[name];
    if (typeof original !== "function" && !(fallback && original === undefined))
        throw new Error("this game build has no MapInterface." + name);
    const own = Object.prototype.hasOwnProperty.call(proto, name);
    const key = "MapInterface." + name;
    const wrapper = function (...args) {
        const all = globalThis[HOOKS_KEY];
        const current = all ? all[key] : undefined;
        if (typeof current === "function")
            return current.call(this, original, args);
        return typeof original === "function" ? original.apply(this, args) : fallback();
    };
    proto[name] = wrapper;
    if (proto[name] !== wrapper)
        throw new Error(`MapInterface.${name} cannot be replaced`);
    hooks[key] = replacement;
    wrapped.push({ proto, name, original, own, wrapper });
}
function unwrapAll() {
    if (globalThis[HOOKS_KEY] === hooks)
        delete globalThis[HOOKS_KEY];
    for (const w of wrapped.splice(0).reverse()) {
        if (w.proto[w.name] !== w.wrapper)
            continue;
        if (w.own)
            w.proto[w.name] = w.original;
        else
            delete w.proto[w.name];
    }
}
// stop(): the mod's icons on a map collapsed and out of its focus list and selection (the map's next rebuild removes
// them). true when the map widget is still there.
function cleanMap(map) {
    const s = map.__mcm;
    if (!s || s.owner !== run)
        return false;
    if (s.timer)
        clearTimeout(s.timer);
    s.timer = undefined;
    map.__mcm = undefined;
    if (!valid(map))
        return false;
    const ours = new Set(s.widgets);
    try {
        const group = map.SlotWidgetGroup;
        const sel = group && typeof group.GetSelectedButtonBase == "function" ? group.GetSelectedButtonBase() : undefined;
        if (sel && ours.has(sel))
            group.ClearSelection();
    }
    catch (e) {
        console.warn(`[${MOD_NAME}] stop: ${e}`);
    }
    const focus = map.focusItemMap;
    for (const key of s.keys) {
        const v = focus && focus.get(key);
        if (v && ours.has(v.widget))
            focus.delete(key);
    }
    const keys = new Set(s.keys);
    if (keys.has(String(map.cursorFocusedIconID || "").toLocaleLowerCase()))
        map.cursorFocusedIconID = "";
    if (keys.has(String(map.lastSnappedIconID || "").toLocaleLowerCase()))
        map.lastSnappedIconID = "";
    for (const w of s.widgets)
        if (valid(w))
            w.SetVisibility(VIS.Collapsed);
    return true;
}
try {
    if (!puerts.argv.getByName("GameInstance"))
        throw new Error("the GameInstance is missing");
    const MapInterface = require("UI/Widget/Map").MapInterface;
    if (!MapInterface || !MapInterface.prototype)
        throw new Error("UI/Widget/Map has no MapInterface");
    const proto = MapInterface.prototype;
    const missing = ["getallowedMapID", "ConvertWorldLocationToScreen", "applyRenderScale", "getElementZoomScale"]
        .filter((name) => typeof proto[name] !== "function");
    if (missing.length)
        throw new Error("this game build has no MapInterface." + missing.join(", MapInterface."));
    wrap(proto, "InitMapText", onMapText);
    wrap(proto, "initAdvancedSlotWidget", onSlotWidget);
    wrap(proto, "getFocusCandidatesSorted", onCandidates);
    wrap(proto, "iconCenterByID", onIconCenter);
    wrap(proto, "Tick", onTick);
    wrap(proto, "switchMap", onSwitchMap);
    try {
        // another map mod may have made OnPreviewKeyDown read-only: then the icons work without the key
        wrap(proto, "OnPreviewKeyDown", onPreviewKey, () => UE.WidgetBlueprintLibrary.Unhandled());
    }
    catch (e) {
        run.noKeys = true;
        console.warn(`[${MOD_NAME}] the hide/show key is off: ${e}`);
    }
    globalThis[HOOKS_KEY] = hooks;
    run.path = settingsPath();
    console.log(`[PBZMOD] [${MOD_NAME}] ${MOD_VERSION} started; settings: ${run.path}` + (menu.on ? " (Mods Menu's page)" : "")
        + "; " + wrapped.length + " map methods wrapped; " + MATERIAL_SPOTS.length + " material spots");
}
catch (e) {
    run.stopped = true;
    unwrapAll();
    console.warn(`[${MOD_NAME}] not started: ${e}`);
    throw e;
}

exports.stop = function () {
    run.stopped = true;
    unwrapAll();
    const cleaned = new Set();
    for (const map of [...maps]) {
        try {
            if (cleanMap(map))
                cleaned.add(map);
        }
        catch (e) {
            console.warn(`[${MOD_NAME}] stop: ${e}`);
        }
    }
    maps.clear();
    session().cleaned = cleaned.size ? cleaned : undefined;
    console.log(`[PBZMOD] [${MOD_NAME}] stopped`);
};
