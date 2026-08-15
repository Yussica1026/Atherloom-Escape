from pathlib import Path
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "test-artifacts"
ARTIFACTS.mkdir(exist_ok=True)


def run_mobile(browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8794", wait_until="networkidle")
    page.locator("#ageGate").wait_for(state="visible")
    page.get_by_role("button", name="我已满 18 岁").click()
    page.locator("#landingView").wait_for(state="visible")
    assert page.get_by_text("有些出口").is_visible()
    page.get_by_role("button", name="抽取并建立房间").click()
    page.locator("#roomView").wait_for(state="visible")
    assert page.locator("#roomWorld").inner_text() in ["古代", "现代", "科幻", "近现代", "中世纪", "西幻"]
    assert page.locator("#roomTone").inner_text() in ["甜宠", "日常", "正剧", "BE", "恐怖"]
    assert "demo（非真实 AI）" in page.locator("#seatList").inner_text()
    page.locator("#actionInput").fill("停摆的钟")
    page.get_by_role("button", name="观察现场").click()
    page.get_by_role("button", name="线索").click()
    assert page.locator(".evidence-card").count() == 1
    assert "停在 02:17 的钟" in page.locator(".evidence-card").inner_text()
    assert page.evaluate("Boolean(localStorage.getItem('atherloom:escape:local-game:v1'))")
    page.screenshot(path=str(ARTIFACTS / "mobile-room.png"), full_page=True)
    page.reload(wait_until="networkidle")
    page.get_by_role("button", name="继续上次现场").click()
    assert page.locator("#roomView").is_visible()
    assert page.locator(".evidence-card").count() == 1
    assert not errors, errors
    context.close()


def run_desktop(browser):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8794", wait_until="networkidle")
    page.get_by_role("button", name="我已满 18 岁").click()
    assert page.locator(".case-cover").is_visible()
    page.screenshot(path=str(ARTIFACTS / "desktop-landing.png"), full_page=True)
    assert not errors, errors
    context.close()


def run_minor_gate(browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.goto("http://127.0.0.1:8794", wait_until="networkidle")
    page.get_by_role("button", name="离开").click()
    assert page.locator("#blockedScreen").is_visible()
    assert not page.locator("#appShell").is_visible()
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    )
    run_mobile(browser)
    run_desktop(browser)
    run_minor_gate(browser)
    browser.close()

print("UI smoke passed: mobile game/save/resume and desktop landing")
