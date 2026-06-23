import { expect, test, type Page } from "@playwright/test";

test("four players can join, take seats, and start a room", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const host = await hostContext.newPage();
  await host.goto("/");
  await host.getByLabel("Name").first().fill("Host");
  await host.getByRole("button", { name: "Create room" }).click();
  await expect(host).toHaveURL(/\/room\/[A-Z0-9]+/);

  const roomUrl = host.url();
  const roomToken = new URL(roomUrl).pathname.split("/").at(-1)!;
  const pages = [host];

  for (const name of ["One", "Two", "Three"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    pages.push(page);
    await page.goto(roomUrl);
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.getByRole("heading", { name: "Players" })).toBeVisible();
  }

  for (let index = 0; index < pages.length; index += 1) {
    await chooseSeat(pages[index], roomToken, index);
  }

  await expect(host.getByRole("button", { name: "Start game" })).toBeEnabled({ timeout: 10_000 });
  await host.getByRole("button", { name: "Start game" }).click();
  await expect(host.getByRole("heading", { name: /Hand 1/ })).toBeVisible();
});

test("mobile lobby and game stay within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Name").first().fill("MobileHost");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page).toHaveURL(/\/room\/[A-Z0-9]+/);

  const roomToken = new URL(page.url()).pathname.split("/").at(-1)!;
  const hostCredentials = await credentialsFor(page, roomToken);

  await expect(page.getByRole("heading", { name: "Players" })).toBeVisible();
  await expect(page.getByText("All Fours Trinidad")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await chooseSeatWithCredentials(page, roomToken, hostCredentials, 0);
  for (const [index, name] of ["One", "Two", "Three"].entries()) {
    const response = await page.request.post(`/api/rooms/${roomToken}/join`, {
      data: { name }
    });
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { playerId: string; playerSecret: string };
    await chooseSeatWithCredentials(page, roomToken, body, index + 1);
  }

  const startResponse = await page.request.post(`/api/rooms/${roomToken}/action`, {
    headers: {
      "x-player-id": hostCredentials.playerId,
      "x-player-secret": hostCredentials.playerSecret
    },
    data: { type: "start-game" }
  });
  expect(startResponse.ok()).toBeTruthy();

  await expect(page.locator(".game-table")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoVerticalOverflow(page);
});

test("host can fill seats with bots and start", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Name").fill("BotHost");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page).toHaveURL(/\/room\/[A-Z0-9]+/);

  const roomToken = new URL(page.url()).pathname.split("/").at(-1)!;
  await chooseSeat(page, roomToken, 0);
  await expect(page.getByRole("button", { name: /Seat 1.*BotHost/ }).first()).toBeVisible();

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Add bot" }).first().click();
  }

  await expect(page.getByText("Bot player")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Start game" })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.getByRole("heading", { name: /Hand 1/ })).toBeVisible();
});

test("hang jack overlay clears while room state keeps polling", async ({ page }) => {
  const roomToken = "HANG123";

  await page.route(`**/api/rooms/${roomToken}/state`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state: mockHangJackState(roomToken) })
    });
  });
  await page.addInitScript((token) => {
    window.localStorage.setItem(
      `simplefours:${token}:credentials`,
      JSON.stringify({ playerId: "p0", playerSecret: "secret-0" })
    );
  }, roomToken);

  await page.goto(`/room/${roomToken}`);
  await expect(page.locator(".hang-overlay")).toBeVisible();
  await expect(page.locator(".hang-overlay")).toBeHidden({ timeout: 5_000 });
});

async function chooseSeat(page: Page, roomToken: string, seat: number) {
  const credentials = await credentialsFor(page, roomToken);
  await chooseSeatWithCredentials(page, roomToken, credentials, seat);
}

async function credentialsFor(page: Page, roomToken: string) {
  const credentials = await page.evaluate((token) => {
    const raw = window.localStorage.getItem(`simplefours:${token}:credentials`);
    return raw ? (JSON.parse(raw) as { playerId: string; playerSecret: string }) : null;
  }, roomToken);
  expect(credentials).not.toBeNull();
  return credentials!;
}

async function chooseSeatWithCredentials(
  page: Page,
  roomToken: string,
  credentials: { playerId: string; playerSecret: string },
  seat: number
) {
  const response = await page.request.post(`/api/rooms/${roomToken}/action`, {
    headers: {
      "x-player-id": credentials.playerId,
      "x-player-secret": credentials.playerSecret
    },
    data: { type: "choose-seat", seat }
  });
  expect(response.ok()).toBeTruthy();
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);
}

async function expectNoVerticalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
    .toBeLessThanOrEqual(1);
}

function mockHangJackState(roomToken: string) {
  return {
    roomToken,
    status: "playing",
    variants: { kicking: "trinidad", trumpLead: "anything" },
    me: { id: "p0", name: "Host", isHost: true, isBot: false, seat: 0 },
    isHost: true,
    players: [
      { id: "p0", name: "Host", isHost: true, isBot: false, seat: 0 },
      { id: "p1", name: "One", isHost: false, isBot: false, seat: 1 },
      { id: "p2", name: "Two", isHost: false, isBot: false, seat: 2 },
      { id: "p3", name: "Three", isHost: false, isBot: false, seat: 3 }
    ],
    seats: [
      { seat: 0, team: 0, player: { id: "p0", name: "Host", isHost: true, isBot: false, seat: 0 }, cardCount: 0 },
      { seat: 1, team: 1, player: { id: "p1", name: "One", isHost: false, isBot: false, seat: 1 }, cardCount: 0 },
      { seat: 2, team: 0, player: { id: "p2", name: "Two", isHost: false, isBot: false, seat: 2 }, cardCount: 0 },
      { seat: 3, team: 1, player: { id: "p3", name: "Three", isHost: false, isBot: false, seat: 3 }, cardCount: 0 }
    ],
    events: [
      {
        id: "hang-jack-repeat",
        at: new Date().toISOString(),
        type: "hangJack",
        seat: 0,
        team: 0,
        message: "Hang Jack! J of spades was captured by Team 1."
      }
    ],
    availableActions: [],
    legalCardIds: [],
    game: {
      phase: "playing",
      handNumber: 1,
      dealerSeat: 0,
      cutSeat: 3,
      turnSeat: 0,
      scores: [0, 0],
      gamePoints: [0, 0],
      proposedTrump: "spades",
      trump: "spades",
      kickCards: [],
      currentTrick: [],
      completedTricks: [],
      scoreLog: [],
      roundSummary: null,
      winnerTeam: null,
      dealerSelection: [],
      forcedLeadSuit: null,
      myHand: [],
      teammateHand: []
    }
  };
}
