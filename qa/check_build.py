"""Smoke test the production build served by npm run preview."""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("GAME_URL", "http://127.0.0.1:4173")

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get("CHROMIUM", "/usr/bin/chromium"),
        args=["--no-sandbox", "--enable-unsafe-swiftshader"],
    )
    page = browser.new_page(viewport={"width": 844, "height": 390}, is_mobile=True, has_touch=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.route("https://st.max.ru/**", lambda route: route.fulfill(
        content_type="application/javascript", body="window.WebApp = { platform: 'android' };"
    ))
    page.goto(BASE)
    bear = page.locator(".bear")
    bear.wait_for(state="attached")
    assert page.locator(".arena").get_attribute("data-map") == "house-of-cards"
    assert page.locator("html").evaluate("html => html.classList.contains('max-mobile')")
    before = bear.get_attribute("transform")
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(260)
    page.keyboard.up("ArrowRight")
    assert bear.get_attribute("transform") != before

    actor = page.locator(".vector-actors")
    normal = [float(value) for value in actor.get_attribute("viewBox").split()]
    cdp = page.context.new_cdp_session(page)
    for event, xs in [("touchStart", (370, 474)), ("touchMove", (320, 524)), ("touchEnd", ())]:
        cdp.send("Input.dispatchTouchEvent", {
            "type": event, "touchPoints": [{"x": x, "y": 190, "id": i} for i, x in enumerate(xs)]
        })
    page.wait_for_function("(width) => Number(document.querySelector('.vector-actors').getAttribute('viewBox').split(' ')[2]) < width",
                           arg=normal[2])
    assert actor.get_attribute("viewBox") == page.locator(".vector-terrain").get_attribute("viewBox")

    # Browser simulation of the project's rotation CSS for MAX on portrait phones.
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_function("getComputedStyle(document.querySelector('.arena')).transform !== 'none'")
    assert page.locator(".map-background").evaluate("""svg => {
      const transform = svg.getScreenCTM();
      const box = svg.viewBox.baseVal;
      const rect = document.querySelector('#field').getBoundingClientRect();
      const [a,b,c,d,e,f] = [transform.a,transform.b,transform.c,transform.d,transform.e,transform.f];
      const xs = [e, e + a*box.width, e + c*box.height, e+a*box.width+c*box.height];
      const ys = [f, f + b*box.width, f + d*box.height, f+b*box.width+d*box.height];
      return Math.min(...xs) <= rect.left+0.05 && Math.max(...xs) >= rect.right-0.05
        && Math.min(...ys) <= rect.top+0.05 && Math.max(...ys) >= rect.bottom-0.05
        && Math.abs(Math.hypot(a,b) - Math.hypot(c,d)) < 0.001;
    }""")
    page.set_viewport_size({"width": 844, "height": 390})
    page.locator(".inventory").click()
    page.locator('[data-weapon="bazooka"]').click()
    page.locator(".shoot").click()
    page.locator("#terrain-crater-clip path[d]").wait_for(state="attached", timeout=9000)
    assert not errors, errors
    print("Production preview: default map, walking, touch pinch, MAX rotation CSS simulation, full SVG cover, real shot/crater.")
