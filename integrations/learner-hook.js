// Injected into a read-only local development overlay, inside the inspected learner boot scope.
// The original useArea/loadPlan/createTest path and all native lesson behaviour remain unchanged.
let importedWorld = null;
window.cambridgeDrive.importWorld = async (text) => {
  await areaChain;
  const nextScene = new T.Scene();
  const loaded = loadWorldTrack(nextScene, text);
  const candidates =
    loaded.plan.waypoints.length > 1
      ? loaded.plan.waypoints
      : (() => {
          const e = loaded.network.edges.find((e) => e.len > 15);
          if (!e)
            throw Error(
              'World needs a connected road segment longer than 15 m for this learner preview.',
            );
          const a = along(e, 3, 1, 0),
            b = along(e, e.len - 3, 1, 0);
          return [
            { x: a.x, z: a.z, road: '' },
            { x: b.x, z: b.z, road: '' },
          ];
        })();
  // Validate the learner route before replacing its current scene.
  buildRoute(
    loaded.network,
    candidates.map((p) => snapWaypoint(loaded.network, p)),
  );
  if (A.test) A.test.running = false;
  const old = scene;
  scene = nextScene;
  renderer.outputEncoding = T.sRGBEncoding;
  scene.add(camera, player.mesh, guide.group, headBeam, headBeam.target);
  carI = bikeI = pedI = 0;
  const net = loaded.network,
    traffic = createTraffic(net, scene, makeCar, makeBk, makePedestrian);
  const world = createLearnerView(scene, loaded),
    test = createTest(net, traffic, player);
  test.onFault = () => ui.renderFaults(test);
  Object.assign(A, {
    id: 'world:' + loaded.world.id,
    net,
    traffic,
    world,
    test,
    trafficInit: false,
  });
  ui.setNet(net);
  disposeScene(old);
  importedWorld = loaded;
  farMode = -2;
  loadPlan({
    kind: 'world-preview',
    key: 'world-preview',
    lesson: { id: 'world-preview', title: loaded.world.title, waypoints: candidates, maxD: 15 },
  });
  player.place(loaded.spawn.x, loaded.spawn.z, loaded.spawn.th);
  hub.closeSheets();
  setMode('drive');
  test.running = true;
  test.elapsed = 0;
  test.startedAt = traffic.clock;
  // Imported tracks retain the actual learner examiner. World editor free drive does not create it.
  $('testState').textContent = 'Imported World · learner assessment preview';
  $('areaLoad').hidden = true;
  return {
    objects: loaded.world.sourceObjects.length + loaded.world.additions.length,
    roads: net.edges.length,
  };
};
window.cambridgeDrive.exportWorld = () => {
  if (!importedWorld || A.id !== 'world:' + importedWorld.world.id)
    throw Error('No imported World is active');
  return importedWorld.export();
};
const worldControls = document.createElement('div');
worldControls.style.cssText =
  'position:fixed;left:12px;top:12px;z-index:10000;background:#eff4e6;color:#17251d;border-radius:8px;padding:8px;font:12px sans-serif;max-width:430px';
worldControls.innerHTML =
  '<strong>World development preview</strong> <input aria-label="Import World track" type="file" accept=".json" style="width:210px"><button type="button">Export World</button><div role="status">Local overlay · existing learner files unchanged</div>';
const worldStatus = worldControls.querySelector('[role=status]');
worldControls.querySelector('input').onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) throw Error('Import exceeds 20 MiB');
    await window.cambridgeDrive.importWorld(await f.text());
    worldStatus.textContent = 'World loaded · complete metadata retained';
  } catch (err) {
    worldStatus.textContent = err.message;
  }
};
worldControls.querySelector('button').onclick = () => {
  try {
    const blob = new Blob([window.cambridgeDrive.exportWorld()], { type: 'application/json' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'learner-world.slaydrive.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    worldStatus.textContent = err.message;
  }
};
document.body.appendChild(worldControls);
