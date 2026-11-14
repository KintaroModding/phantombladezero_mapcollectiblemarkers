# Map Collectible Markers

The region map shows the collectibles you have not picked up yet (Black Stone and Amber fragments, Memory Flowers, Major Chests, keys, challenges, unrung bells, gear and about 600 upgrade-material spots) with their names and where they come from; icons under unexplored fog stay hidden. A PBZModLoader mod; settings in a text file in its folder, or on its Mods Menu page.

A [PBZModLoader](https://github.com/KintaroModding/phantombladezero_pbzmodloader) mod for Phantom Blade Zero (Unreal Engine
5.7), made with game version `CL-302256_JKS-17280` and PBZModLoader 2.1.0. This README is for developers.
What the mod does, how to install it and its compatibility are in [openmods.md](openmods.md), the mod page on
[openmods](https://openmods.nexus).

## How it works

The game runs much of its logic in JavaScript (Puerts). PBZModLoader loads every folder in
`ProjectPBZ/PBZModLoader/mods/` that has a `main.js`, through the game's own module system, after the game's
`MainStart`; `require("ue")`, `require("puerts")` and `require("Library/TsHelper")` are the game's modules, and
`puerts.argv.getByName("GameInstance")` gives the game instance. Before a reload (Alt+F5) the loader awaits the mod's
`stop()`, which must give back everything the mod changed.

The game's map script `UI/Widget/Map.js` exports `MapInterface`, the mixin of the map widget `WB_MapNew_C`. It has
`initAdvancedSlot_HeiShi`, `_HuPo`, `_Flower`, `_PrimaryItem`, `_YaoShi` and `_Challenge`, which would draw these
collectibles from the lists of `W_MapItemCompletionUI` (the items still missing on the shown page), but their calls in
`initAdvancedSlotWidget` are commented out. The mod wraps seven `MapInterface` methods in memory:

- **`InitMapText`:** the map rebuilds the completion lists in a `setTimeout(0)`; the mod draws its icons in a timer
  after that one (and waits while the game's timer is still pending), but not while the first open's frame-split build
  is pending (`pendingInitSlice`): that build calls `initAdvancedSlotWidget`, which draws them.
- **`initAdvancedSlotWidget`:** after the game's own slots (it removes all of `AdvancedSlots`, the mod's icons too),
  the mod places its icons with the same steps as the six functions: `CreateWidget` from the map's pool,
  `applyRenderScale(1)`, `OwnMapID`, `InitWidget(label, key)`, `SlotWidgetGroup.AddWidget`, `focusItemMap` (a `Lock`
  item), `Gadget.AddChild`, `AdvancedSlots.Add`, and the canvas slot's size, alignment, z-order and position. It uses the
  game's widget classes and keys, one icon per Major Chest, skips spots the map projects to 0,0, and draws each picture
  4.5 times bigger than its slot. The mod copies no game function and evaluates no code (the source mod compiled
  copies of the six functions with `new Function`; the exe has a message "Untrusted script evaluation is disabled in
  Shipping").
- **Gear and material spots** (drawn the same way with the Major Chest class and the "Collection details" pictures
  `T_Map_CollectionProgress_*`): bells of the map data that are not in `BellManager.GetAllActivateBellIDs`, weapons,
  shadow weapons, accessories and medicines not in the backpack in this playthrough (`AcquiredCycle` vs
  `PBZGameSystem.GetCycleCount`), none within 200 units of a Major Chest icon; and the 598 `MATERIAL_SPOTS` of the source
  mod (read out of the level files of build 26266538), each until its actor has save data
  (`PBZLevelActorManager.HasSaveDataByActorID`), 13 of them only while the Blood Forest's snow story tag is set.
- **Labels:** the game's texts, with the source mod's words for the ones the game left empty (`UI_Map_21` to `25`), a
  second line from the map data's source fields (`FlowAssetName`, `MobDomainName`, `NodeGuids`, `SaveGuidString`:
  a named boss or NPC for about 70 story flows), and for `meigu_yiji` a line that the item is inside the Illusionist's
  Ruins.
- **Fog (`HideUnderFog`):** the patches still fogged come from the map's mask widget (`GetMaskMap`) minus the ones the
  save has cleared (`MapSubsystem.GetUnLockMaskIDs`); their pictures are drawn into a small render target and read
  back (`KismetRenderingLibrary.ReadRenderTarget`, else pixel by pixel), so an icon is hidden where fog is drawn over
  it. Without pictures the nearest patch rectangle decides. A page whose fog loads later is checked again from `Tick`
  for up to 5 s.
- **`getFocusCandidatesSorted`** and **`iconCenterByID`:** hidden icons (`ToggleKey`, `ControllerKey`, `Enable=Off`, found under fog
  later) are left out of the hover and gamepad pick.
- **`Tick`:** the settings, at most every 2 s; keyboard focus for the map page 250 ms after it shows (it never takes
  it, so its key events would never fire); the late fog check.
- **`OnPreviewKeyDown`** (the map script has none; the mod adds it): `ToggleKey` and (1.1) `ControllerKey`, a
  controller button: Slate hands controller buttons to the focused widget as key events too (`Gamepad_DPad_Up` and
  so on). Each controller button the page gets is named once in the log, so a game test shows which ones arrive.
  And Tab, which Slate takes as "next widget" while the page has focus, so the mod calls `switchMap` itself. **`switchMap`:** while the key is on, a second
  switch within 250 ms is dropped.

Puerts' `blueprint.mixin` copies the methods of `MapInterface.prototype` when the map class mixes (`MainStart.js`,
`GameInstance.OnStartMixinDelegate`), and the game keeps that copy across Alt+F5. So each wrapper looks up its
replacement in `globalThis.__mapCollectibleMarkersHooks` at call time (the running copy fills it at start, `stop()`
deletes it), and the mod adds no other method to the class: its helpers are module functions, its state per map widget
is `map.__mcm`. `stop()` puts the game's methods back, collapses the mod's icons and takes them out of `focusItemMap`
and the selection (the map's next rebuild removes them), and names those maps in
`globalThis.__mapCollectibleMarkersSession`, so the next copy draws them again at the next frame. The same object keeps
the hide or show choice until the game is closed. Nothing is written into the save.

The port (1.0) of an earlier mod of the author, "Map Collectible Markers" 1.3.4 (Fog version): a block appended to the
game script `UI/Widget/Foundation/BoundActionBarReveal.js` in a pak (it needs a script bypass since the 2026-11-04
update). Its data (`MATERIAL_SPOTS`, `SOURCE_WHO`, the tints and fog values) is taken over unchanged; its debug and
teleport-to-item parts (off in that build) are left out.

`tests/test_mod.js` runs the script in Node.js against a stand-in map class that mixes like Puerts (a copy of the
methods), with its timers, completion lists, map data, backpack and fog patches (93 checks).

- **Settings file:** `phantombladezero_mapcollectiblemarkers.txt` next to `main.js` (`__dirname`, the mod's folder as a full path), read at
  most every 2 s while the region map shows, with `EasyCsv.LoadStringFromLocalFile` and written with the defaults when missing. The shipped file is exactly the
  script's default text (`tests/test_mod.js` checks it).
- **Mods Menu, optional:** PBZModLoader starts its mods after Mods Menu's, so a running Mods Menu (0.9.0 or later) has
  its registry object in `globalThis.PBZModsMenu` by then. Only when it has the features `settingsPath` and
  `store.saved`, the mod pushes its page (id `phantombladezero_mapcollectiblemarkers`, `store: "saved"`) and reads the file the page saves
  (`PBZModsMenu.settingsPath(id)`, in Mods Menu's Saved folder): a registered page cannot save anywhere else.
- **Log:** `console.log` lines that start with `[PBZMOD]` and the game's warnings reach `ProjectPBZ/PBZModLoader/loader.log`.

## Check and deploy

Requirements: Windows PowerShell 5.1 and [Node.js](https://nodejs.org/) (for `node --check` and the offline test).

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1             # node --check, tests\test_mod.js
powershell -ExecutionPolicy Bypass -File .\build.ps1 -Deploy     # the checks, then deploy.ps1
powershell -ExecutionPolicy Bypass -File .\deploy.ps1            # copy src\phantombladezero_mapcollectiblemarkers to the game
```

`deploy.ps1` mirrors `src\phantombladezero_mapcollectiblemarkers\` to `<game folder>\ProjectPBZ\PBZModLoader\mods\phantombladezero_mapcollectiblemarkers\`. The
settings file that is already there is the tester's and stays; `-ResetConfig` copies the shipped one. The game folder
comes from `gameDir` in `_tools\gamedata\phantombladezero\game.json`, else `$env:UE5_GAMES_DIR\PBZ`; `-GameDir` or
`-ModsDir` override it. It stops when PBZModLoader is not installed (its start file
`ProjectPBZ\Content\JavaScript\PBZModLoader\bootstrap.js` is missing).

The GitHub release zip holds the mod folder at `ProjectPBZ/PBZModLoader/mods/phantombladezero_mapcollectiblemarkers/`, so players unpack it
into the game folder.

Versioning: every change raises the second number in `mod.json` and `main.js` (1.0 -> 1.1): `python scripts\bump_version.py`.

## Project layout

```
src/phantombladezero_mapcollectiblemarkers/   The mod folder: main.js and the shipped settings file
tests/test_mod.js     Offline test of main.js (Node.js, stand-ins for the game)
docs/                 Cover and screenshots
scripts/              bump_version.py, check_openmods.py, publish.ps1
build.ps1, deploy.ps1 Checks; copy into the game
mod.json              Name, version, game, kind pbzmodloader, modsPath
```

## License

MIT, see [LICENSE](LICENSE).
