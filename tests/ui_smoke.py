from pathlib import Path
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "test-artifacts"
ARTIFACTS.mkdir(exist_ok=True)
URL = "http://127.0.0.1:8794"


def page_with_errors(context):
    page = context.new_page()
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL, wait_until="networkidle")
    page.locator("#ageGate").wait_for(state="visible")
    page.locator("#confirmAdult").click()
    page.locator('input[name="connection"][value="local"]').check(force=True)
    return page, errors


def test_human_player_ai_spectator(browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page, errors = page_with_errors(context)
    page.locator('input[name="mode"][value="human_play_ai_watch"]').check(force=True)
    page.locator("#playerPersonaName").fill("沈砚清")
    page.locator("#refereeName").fill("雾中裁判")
    page.locator("#refereeRoute").select_option("local-demo")
    page.locator("#createForm button[type=submit]").click()
    page.locator("#roomView").wait_for(state="visible")
    assert "雾中裁判" in page.locator("#refereeDisplayName").inner_text()
    assert "本机规则演示" in page.locator("#refereeRouteLabel").inner_text()
    assert "雾中裁判" not in page.locator("#seatList").inner_text()
    assert page.locator(".seat--spectator").count() == 1
    assert "沈砚清" in page.locator(".seat--spectator").inner_text()
    assert page.locator("#observeAction").is_enabled()
    page.locator("#chatInput").fill("你在观战席看见什么？")
    page.locator("#chatForm button[type=submit]").click()
    assert page.locator(".chat-line").count() == 2
    assert page.locator(".chat-line--demo").count() == 1
    page.locator("#actionInput").fill("查看停摆的钟")
    page.locator("#observeAction").click()
    page.locator('button[data-panel="evidence"]').click()
    assert page.locator(".evidence-card").count() == 1
    assert page.evaluate("Boolean(localStorage.getItem('atherloom:escape:local-game:v1'))")
    assert page.evaluate("document.documentElement.dataset.world.length > 0")
    page.screenshot(path=str(ARTIFACTS / "mobile-watch-chat.png"), full_page=True)
    page.reload(wait_until="networkidle")
    page.locator('input[name="connection"][value="local"]').check(force=True)
    page.locator("#resumeGame").click()
    assert page.locator(".chat-line").count() == 2
    assert not errors, errors
    context.close()


def test_ai_player_human_spectator_trpg(browser):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page, errors = page_with_errors(context)
    page.locator('input[name="gameType"][value="trpg"]').check(force=True)
    page.locator('input[name="mode"][value="ai_play_human_watch"]').check(force=True)
    page.locator("#playerPersonaName").fill("沈砚清")
    page.locator("#refereeName").fill("夜航主持")
    page.locator("#createForm button[type=submit]").click()
    page.locator("#trpgDesk").wait_for(state="visible")
    assert page.locator("#roomPlan").is_visible()
    assert page.locator("#generatedMap").get_attribute("data-kind") == "route"
    assert page.locator("#observeAction").is_disabled()
    assert page.locator("#rollD20").is_disabled()
    assert "观战席" in page.locator("#seatList").inner_text()
    assert "沈砚清" in page.locator("#characterName").inner_text()
    assert page.locator("#diceResult").inner_text() != "—"
    assert "夜航主持" not in page.locator("#seatList").inner_text()
    assert "电流" not in page.locator("#sceneDescription").inner_text()
    page.locator("#chatInput").fill("继续，我在看。")
    page.locator("#chatForm button[type=submit]").click()
    assert page.locator(".chat-line").count() == 2
    assert page.evaluate("document.documentElement.dataset.game === 'trpg'")
    page.screenshot(path=str(ARTIFACTS / "mobile-trpg-spectator.png"), full_page=True)
    assert not errors, errors
    context.close()


def test_trpg_player_roll(browser):
    context = browser.new_context(viewport={"width": 430, "height": 900})
    page, errors = page_with_errors(context)
    page.locator('input[name="gameType"][value="trpg"]').check(force=True)
    page.locator('input[name="mode"][value="human_play_ai_watch"]').check(force=True)
    page.locator("#createForm button[type=submit]").click()
    assert page.locator("#rollD20").is_enabled()
    page.locator("#rollD20").click()
    assert page.locator("#diceResult").inner_text() != "—"
    page.locator("#actionInput").fill("向守门人出示未署名的信")
    page.locator("#observeAction").click()
    assert page.locator("#roundNumber").inner_text() == "3"
    assert not errors, errors
    context.close()


def test_desktop_and_minor_gate(browser):
    desktop = browser.new_context(viewport={"width": 1440, "height": 900})
    page, errors = page_with_errors(desktop)
    assert page.locator(".case-cover").is_visible()
    assert page.locator("#displayName").input_value() == ""
    assert page.locator("#playerPersonaName").input_value() == ""
    assert page.locator('.game-type-fieldset input[value="escape"]').is_checked()
    page.screenshot(path=str(ARTIFACTS / "desktop-landing-v2.png"), full_page=True)
    assert not errors, errors
    desktop.close()

    minor = browser.new_context(viewport={"width": 390, "height": 844})
    page = minor.new_page()
    page.goto(URL, wait_until="networkidle")
    page.locator("#declineAdult").click()
    assert page.locator("#blockedScreen").is_visible()
    assert not page.locator("#appShell").is_visible()
    minor.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    )
    test_human_player_ai_spectator(browser)
    test_ai_player_human_spectator_trpg(browser)
    test_trpg_player_roll(browser)
    test_desktop_and_minor_gate(browser)
    browser.close()

print("UI smoke passed: spectators/chat/TRPG/referee separation/theme/save/resume/minor gate")
