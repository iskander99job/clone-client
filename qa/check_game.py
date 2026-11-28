"""Run against npm run dev using Python Playwright and Chromium."""
import math
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("GAME_URL", "http://127.0.0.1:5173")
OUT = Path(__file__).resolve().parent / "screenshots"
OUT.mkdir(exist_ok=True)


def hook_island(route):
    response = route.fetch()
    marker = "const fighter = duel.fighters[0];"
    source = response.text()
    assert marker in source
    route.fulfill(response=response, body=source.replace(
        marker, "window.qa = { duel, map, scene }; " + marker
    ))


def load(page, name="house-of-cards"):
    page.goto(f"{BASE}/?map={name}")
    page.locator(".bear").wait_for(state="attached")
    page.wait_for_function("window.qa?.duel.playerGrounded()")


def geometry(page, expected_zoom=None):
    result = page.evaluate("""() => {
      const { scene, map } = qa;
      const camera = scene.cameras.main;
      const field = document.querySelector('#field');
      const actor = document.querySelector('.vector-actors');
      const terrain = document.querySelector('.vector-terrain');
      const svg = document.querySelector('.map-background');
      const fieldRect = field.getBoundingClientRect();
      const bg = svg.getScreenCTM();
      const vb = svg.viewBox.baseVal;
      const actorMatrix = actor.getScreenCTM();
      const p = camera.getWorldPoint(0, 0);
      const end = camera.getWorldPoint(camera.width, camera.height);
      const water = document.querySelector('.water').getBoundingClientRect();
      const waterTop = (map.waterY - p.y) * camera.zoom;
      const scale = Math.min(camera.width / map.width, camera.height / map.height);
      return {
        zoom: camera.zoom / scale,
        scale: camera.zoom,
        left: p.x, top: p.y, right: end.x, bottom: end.y,
        viewport: [camera.width, camera.height],
        sameWorldView: actor.getAttribute('viewBox') === terrain.getAttribute('viewBox'),
        actorOrigin: [actorMatrix.e - fieldRect.left, actorMatrix.f - fieldRect.top],
        waterTop, waterError: Math.abs(water.top - fieldRect.top - waterTop),
        bgMatrix: [bg.a, bg.d, bg.e, bg.f],
        bgCovers: bg.e <= fieldRect.left + 0.05 && bg.f <= fieldRect.top + 0.05
          && bg.e + vb.width * bg.a >= fieldRect.right - 0.05
          && bg.f + vb.height * bg.d >= fieldRect.bottom - 0.05,
        bgViewBox: svg.getAttribute('viewBox'),
      };
    }""")
    assert result["sameWorldView"], result
    if expected_zoom is not None:
        assert math.isclose(result["zoom"], expected_zoom, abs_tol=0.001), result
    assert result["waterError"] < 0.05, result
    assert result["bgCovers"] and result["bgViewBox"] == "0 0 1400 700", result
    assert math.isclose(result["bgMatrix"][0], result["bgMatrix"][1], abs_tol=0.0001), result
    for actual, expected in zip(result["actorOrigin"], [-result["left"] * result["scale"], -result["top"] * result["scale"]]):
        assert abs(actual - expected) < 0.15, result
    return result


def capture(page, label):
    page.screenshot(path=str(OUT / f"{label}.png"))


def zoom(page, delta):
    page.mouse.move(422, 195)
    page.mouse.wheel(0, delta)
    page.wait_for_timeout(180)


def pan(page, x, y):
    for _ in range(4):
        page.mouse.move(422, 195)
        page.mouse.down()
        page.mouse.move(422 + x, 195 + y, steps=6)
        page.mouse.up()


with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get("CHROMIUM", "/usr/bin/chromium"),
        args=["--no-sandbox", "--enable-unsafe-swiftshader"],
    )
    page = browser.new_page(viewport={"width": 844, "height": 390}, has_touch=True, is_mobile=True)
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.route("https://st.max.ru/**", lambda route: route.fulfill(status=200, body=""))
    page.route("**/src/island-fighter.ts*", hook_island)

    load(page)
    normal = geometry(page, 1)
    capture(page, "02-normal")
    zoom(page, 4000)
    minimum = geometry(page, 0.75)
    capture(page, "01-minimum")
    zoom(page, -4000)
    maximum = geometry(page, 1.75)
    capture(page, "03-maximum")
    assert normal["bgMatrix"] == minimum["bgMatrix"] == maximum["bgMatrix"]
    assert page.get_by_role("main").get_attribute("data-map") == "house-of-cards"

    pan(page, 330, 0)
    left = geometry(page, 1.75)
    assert abs(left["left"]) < 0.01, left
    capture(page, "04-left")
    pan(page, -330, 0)
    right = geometry(page, 1.75)
    assert abs(right["right"] - 2160) < 0.01, right
    capture(page, "05-right")
    pan(page, 0, 140)
    top = geometry(page, 1.75)
    assert abs(top["top"] + 78 / top["scale"]) < 0.01, top
    capture(page, "06-top")
    pan(page, 0, -140)
    bottom = geometry(page, 1.75)
    assert abs(bottom["bottom"] - 1080 - 78 / bottom["scale"]) < 0.01, bottom
    capture(page, "07-bottom")
    assert all(item["bgMatrix"] == normal["bgMatrix"] for item in (left, right, top, bottom))
    print("Camera 0.75/1/1.75; four pan limits; fixed proportional SVG cover; matching terrain/actors/Phaser/water")

    for width, height in [(1280, 720), (1024, 320), (390, 844), (844, 390)]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_function(
            "(size) => qa.scene.cameras.main.width === size[0] && qa.scene.cameras.main.height === size[1]",
            arg=[width, height],
        )
        page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        geometry(page, 1.75)
    print("Resized game in place: 1280x720, 1024x320, 390x844, 844x390")

    load(page)
    page.locator(".inventory").click()
    page.locator('[data-weapon="bazooka"]').click()
    page.keyboard.down("ArrowUp")
    page.wait_for_timeout(780)
    page.keyboard.up("ArrowUp")
    page.locator(".jump-forward").click()
    page.wait_for_function("qa.duel.fighters[0].body.linvel().y < -80")
    page.locator(".shoot").click()
    page.wait_for_function("Boolean(qa.duel.rocket)", timeout=2000)
    zoom(page, -280)
    geometry(page)
    projectile = page.evaluate("""() => {
      const { duel, scene } = qa;
      const rocket = duel.rocket?.translation();
      const effects = scene.children.getByName('shot-effects');
      if (!rocket) return null;
      return { rocket, graphics: effects.commandBuffer };
    }""")
    assert projectile, "Rocket no longer in flight"
    coords = projectile["rocket"]
    values = projectile["graphics"]
    assert any(abs(values[i] - coords["x"]) < 0.01 and abs(values[i+1] - coords["y"]) < 0.01
               and values[i+2] == 6 for i in range(len(values)-2)), projectile
    assert page.locator(".vector-actors").locator(".bear").count() == 1
    page.locator("#terrain-crater-clip path[d]").wait_for(state="attached", timeout=9000)
    assert page.evaluate("!qa.duel.solid(qa.duel.blast.x, qa.duel.blast.y)")
    print("HUD shot in flight while zooming; graphics share rocket's physics XY; impact cuts mask and SVG")

    for map_id in ("house-of-cards", "flat", "fruit-foreground", "quarry", "fruit"):
        load(page, map_id)
        for index in range(4):
            usable = page.evaluate("""(index) => {
              const { map, duel } = qa;
              const point = map.spawnPoints[index];
              const location = duel.findSpawn(index, []);
              if (!location || location.x !== point.x) return false;
              const body = duel.fighters[0].body;
              body.setTranslation(location, true);
              body.setLinvel({ x: 0, y: 0 }, true);
              return true;
            }""", index)
            assert usable, (map_id, index)
            page.wait_for_timeout(330)
            settled = page.evaluate("""(index) => {
              const { duel, map } = qa;
              const point = map.spawnPoints[index];
              const position = duel.fighters[0].body.translation();
              return duel.playerGrounded() && Math.abs(position.x - point.x) < 12
                && Math.abs(position.y + 31 - point.y) < 10;
            }""", index)
            assert settled, (map_id, index)
            if map_id == "house-of-cards":
                capture(page, f"spawn-{index + 1}")
        print(f"{map_id}: all 4 configured spawns settled on actual ground")

    load(page)
    page.evaluate("""() => {
      const { duel, map } = qa;
      const point = map.spawnPoints[0];
      duel.explode({ x: point.x, y: point.y });
      const body = duel.fighters[0].body;
      body.setTranslation({ x: 90, y: map.waterY - 75 }, true);
      body.setLinvel({ x: 0, y: 140 }, true);
    }""")
    page.wait_for_function("Math.abs(qa.duel.fighters[0].body.translation().x - qa.map.spawnPoints[1].x) < 4")
    page.wait_for_function("qa.duel.playerGrounded()")
    assert page.evaluate("!qa.duel.solid(qa.map.spawnPoints[0].x, qa.map.spawnPoints[0].y + 5)")
    assert page.locator("#terrain-crater-clip path[d]").count() == 1
    capture(page, "08-destroyed-spawn")

    page.evaluate("""() => {
      const { duel, map } = qa;
      const body = duel.fighters[0].body;
      const other = duel.fighters[1].body;
      other.setEnabled(true);
      other.setTranslation(body.translation(), true);
      other.setLinvel({x:0,y:0}, true);
      body.setTranslation({ x: 90, y: map.waterY - 10 }, true);
      body.setLinvel({ x: 0, y: 150 }, true);
    }""")
    page.wait_for_function("Math.abs(qa.duel.fighters[0].body.translation().x - qa.map.spawnPoints[2].x) < 4")
    page.wait_for_function("qa.duel.playerGrounded()")
    print("Real fall into water: destroyed start rejected; occupied reserve rejected on next fall")

    page.evaluate("""() => {
      const { duel, map } = qa;
      for (const point of map.spawnPoints.slice(1)) duel.explode(point);
      duel.fighters[0].body.setTranslation({ x: 90, y: map.waterY + 1 }, true);
    }""")
    page.wait_for_function("!qa.duel.fighters[0].body.isEnabled() && document.querySelector('.bear').getAttribute('display') === 'none'")
    assert page.locator(".shoot").is_disabled()
    print("No usable spawn: character waits outside play, firing disabled")

    legacy = page.evaluate("""async () => {
      const { Duel } = await import('/src/duel.ts');
      const { duel, map } = qa;
      const original = new Duel(false, undefined, {
        width: 640, height: 510, waterY: 440, shotSpeed: 1, spawn: [83, 556],
      });
      const position = original.fighters[0].body.translation();
      original.fighters[0].body.setTranslation({ x: 90, y: 450 }, true);
      original.tick();
      const result = [position.x, original.fighters[0].hp];
      original.world.free();
      return result;
    }""")
    assert abs(legacy[0] - 83) < 3 and legacy[1] == 0, legacy
    assert not errors, errors
    print("Legacy X-only spawn and defeat on water in non-respawn duel")
