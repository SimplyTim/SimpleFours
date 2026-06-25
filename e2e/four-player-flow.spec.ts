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

test("mobile playing layout keeps status clear and side hands vertical", async ({ page }) => {
  const roomToken = "LAYOUT1";

  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/rooms/${roomToken}/state`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state: mockMobileLayoutState(roomToken) })
    });
  });
  await page.addInitScript((token) => {
    window.localStorage.setItem(
      `simplefours:${token}:credentials`,
      JSON.stringify({ playerId: "p1", playerSecret: "secret-1" })
    );
  }, roomToken);

  await page.goto(`/room/${roomToken}`);
  await expect(page.locator(".waiting-status-banner")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoVerticalOverflow(page);

  const waitingBox = await requiredBox(page, ".waiting-status-banner");
  expect(await page.locator(".table-zone .waiting-status-banner").count()).toBe(0);
  expect(rectsOverlap(waitingBox, await requiredBox(page, ".table-zone"))).toBeFalsy();
  for (const selector of [".player-seat-1", ".player-seat-3", ".table-center"]) {
    expect(rectsOverlap(waitingBox, await requiredBox(page, selector))).toBeFalsy();
  }
  await expectCenterClear(page);

  const sideCardBoxes = await page.locator(".player-seat-1 .hand-row .playing-card").evaluateAll((cards) =>
    cards.slice(0, 4).map((card) => {
      const rect = card.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
  );
  expect(sideCardBoxes.length).toBeGreaterThanOrEqual(4);
  for (let index = 1; index < sideCardBoxes.length; index += 1) {
    expect(Math.abs(sideCardBoxes[index].x - sideCardBoxes[0].x)).toBeLessThanOrEqual(8);
    expect(sideCardBoxes[index].y).toBeGreaterThan(sideCardBoxes[index - 1].y + 4);
  }
});

test("short desktop layout keeps the bottom player hand visible", async ({ page }) => {
  const roomToken = "BOTTOM1";

  await page.setViewportSize({ width: 1425, height: 625 });
  await page.route(`**/api/rooms/${roomToken}/state`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state: mockDesktopBottomSeatState(roomToken) })
    });
  });
  await page.addInitScript((token) => {
    window.localStorage.setItem(
      `simplefours:${token}:credentials`,
      JSON.stringify({ playerId: "p1", playerSecret: "secret-1" })
    );
  }, roomToken);

  await page.goto(`/room/${roomToken}`);
  await expect(page.locator(".player-seat-2")).toBeVisible();
  await expect(page.locator(".game-grid > .waiting-status-banner")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoVerticalOverflow(page);

  const tableBox = await requiredBox(page, ".table-zone");
  const waitingBox = await requiredBox(page, ".waiting-status-banner");
  expect(await page.locator(".table-zone .waiting-status-banner").count()).toBe(0);
  expect(rectsOverlap(waitingBox, tableBox)).toBeFalsy();
  const bottomSeatBox = await requiredBox(page, ".player-seat-2");
  const bottomHandBox = await requiredBox(page, ".player-seat-2 .hand-row");
  expect(bottomSeatBox.y + bottomSeatBox.height).toBeLessThanOrEqual(tableBox.y + tableBox.height - 1);
  expect(bottomHandBox.y + bottomHandBox.height).toBeLessThanOrEqual(bottomSeatBox.y + bottomSeatBox.height - 1);
  await expectDesktopSideHandRoom(page);
  await expectCenterClear(page);
});

test("dealer decision keeps the dealer hand clear after a beg", async ({ page }) => {
  const roomToken = "DEALER1";

  await page.route(`**/api/rooms/${roomToken}/state`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state: mockDealerDecisionState(roomToken) })
    });
  });
  await page.addInitScript((token) => {
    window.localStorage.setItem(
      `simplefours:${token}:credentials`,
      JSON.stringify({ playerId: "p0", playerSecret: "secret-0" })
    );
  }, roomToken);

  await page.goto(`/room/${roomToken}`);
  await expect(page.locator(".table-decision-prompt")).toBeVisible();
  await expect(page.locator(".table-play-surface")).toHaveClass(/show-own-hand-during-prompt/);

  const dealerSeatStyle = await page.locator(".my-seat").evaluate((seat) => {
    const style = window.getComputedStyle(seat);
    return { filter: style.filter, opacity: style.opacity };
  });
  expect(dealerSeatStyle.filter).toBe("none");
  expect(dealerSeatStyle.opacity).toBe("1");
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

async function requiredBox(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function expectCenterClear(page: Page) {
  const centerBox = await requiredBox(page, ".table-center");
  for (const selector of [".player-seat-0", ".player-seat-1", ".player-seat-2", ".player-seat-3"]) {
    expect(rectsOverlap(centerBox, await requiredBox(page, selector))).toBeFalsy();
  }
}

async function expectDesktopSideHandRoom(page: Page) {
  const sideSeatBox = await requiredBox(page, ".player-seat-1");
  expect(sideSeatBox.height).toBeGreaterThan(280);

  const sideCardBoxes = await page.locator(".player-seat-1 .hand-row .playing-card").evaluateAll((cards) =>
    cards.slice(0, 4).map((card) => {
      const rect = card.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
  );
  expect(sideCardBoxes.length).toBeGreaterThanOrEqual(4);
  for (let index = 1; index < sideCardBoxes.length; index += 1) {
    expect(sideCardBoxes[index].y - sideCardBoxes[index - 1].y).toBeGreaterThanOrEqual(36);
  }
}

function rectsOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number }
) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
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
    availableActions: [] as { type: string; label: string }[],
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

function mockMobileLayoutState(roomToken: string) {
  return {
    roomToken,
    status: "playing",
    variants: { kicking: "trinidad", trumpLead: "anything" },
    me: { id: "p1", name: "One", isHost: false, isBot: false, seat: 1 },
    isHost: false,
    players: [
      { id: "p0", name: "Host", isHost: true, isBot: false, seat: 0 },
      { id: "p1", name: "One", isHost: false, isBot: false, seat: 1 },
      { id: "p2", name: "Two", isHost: false, isBot: false, seat: 2 },
      { id: "p3", name: "Three", isHost: false, isBot: false, seat: 3 }
    ],
    seats: [
      { seat: 0, team: 0, player: { id: "p0", name: "Host", isHost: true, isBot: false, seat: 0 }, cardCount: 5 },
      { seat: 1, team: 1, player: { id: "p1", name: "One", isHost: false, isBot: false, seat: 1 }, cardCount: 6 },
      { seat: 2, team: 0, player: { id: "p2", name: "Two", isHost: false, isBot: false, seat: 2 }, cardCount: 5 },
      { seat: 3, team: 1, player: { id: "p3", name: "Three", isHost: false, isBot: false, seat: 3 }, cardCount: 6 }
    ],
    events: [],
    availableActions: [] as { type: string; label: string }[],
    legalCardIds: [],
    game: {
      phase: "playing",
      handNumber: 1,
      dealerSeat: 0,
      cutSeat: 3,
      turnSeat: 2,
      scores: [0, 0],
      gamePoints: [0, 0],
      proposedTrump: "spades",
      trump: "spades",
      kickCards: [{ id: "K-spades", rank: "K", suit: "spades" }],
      currentTrick: [
        { seat: 0, card: { id: "A-hearts", rank: "A", suit: "hearts" } },
        { seat: 2, card: { id: "10-hearts", rank: "10", suit: "hearts" } }
      ],
      completedTricks: [],
      scoreLog: [],
      roundSummary: null,
      winnerTeam: null,
      dealerSelection: [],
      forcedLeadSuit: null,
      myHand: [
        { id: "A-spades", rank: "A", suit: "spades" },
        { id: "Q-spades", rank: "Q", suit: "spades" },
        { id: "J-spades", rank: "J", suit: "spades" },
        { id: "8-hearts", rank: "8", suit: "hearts" },
        { id: "7-diamonds", rank: "7", suit: "diamonds" },
        { id: "2-clubs", rank: "2", suit: "clubs" }
      ],
      teammateHand: [
        { id: "K-hearts", rank: "K", suit: "hearts" },
        { id: "Q-hearts", rank: "Q", suit: "hearts" },
        { id: "9-spades", rank: "9", suit: "spades" },
        { id: "6-diamonds", rank: "6", suit: "diamonds" },
        { id: "5-clubs", rank: "5", suit: "clubs" },
        { id: "3-clubs", rank: "3", suit: "clubs" }
      ]
    }
  };
}

function mockDesktopBottomSeatState(roomToken: string) {
  return {
    roomToken,
    status: "playing",
    variants: { kicking: "trinidad", trumpLead: "anything" },
    me: { id: "p1", name: "Tim", isHost: true, isBot: false, seat: 1 },
    isHost: true,
    players: [
      { id: "p0", name: "Anansi Bot", isHost: false, isBot: true, seat: 0 },
      { id: "p1", name: "Tim", isHost: true, isBot: false, seat: 1 },
      { id: "p2", name: "Calypso Bot", isHost: false, isBot: true, seat: 2 },
      { id: "p3", name: "Moko Bot", isHost: false, isBot: true, seat: 3 }
    ],
    seats: [
      { seat: 0, team: 0, player: { id: "p0", name: "Anansi Bot", isHost: false, isBot: true, seat: 0 }, cardCount: 9 },
      { seat: 1, team: 1, player: { id: "p1", name: "Tim", isHost: true, isBot: false, seat: 1 }, cardCount: 9 },
      { seat: 2, team: 0, player: { id: "p2", name: "Calypso Bot", isHost: false, isBot: true, seat: 2 }, cardCount: 9 },
      { seat: 3, team: 1, player: { id: "p3", name: "Moko Bot", isHost: false, isBot: true, seat: 3 }, cardCount: 9 }
    ],
    events: [],
    availableActions: [] as { type: string; label: string }[],
    legalCardIds: [],
    game: {
      phase: "playing",
      handNumber: 1,
      dealerSeat: 0,
      cutSeat: 3,
      turnSeat: 2 as number | null,
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
      myHand: [
        { id: "6-spades", rank: "6", suit: "spades" },
        { id: "10-hearts", rank: "10", suit: "hearts" },
        { id: "7-hearts", rank: "7", suit: "hearts" },
        { id: "4-hearts", rank: "4", suit: "hearts" },
        { id: "6-diamonds", rank: "6", suit: "diamonds" },
        { id: "5-diamonds", rank: "5", suit: "diamonds" },
        { id: "A-clubs", rank: "A", suit: "clubs" },
        { id: "J-clubs", rank: "J", suit: "clubs" },
        { id: "9-clubs", rank: "9", suit: "clubs" }
      ],
      teammateHand: [
        { id: "10-clubs", rank: "10", suit: "clubs" },
        { id: "K-hearts", rank: "K", suit: "hearts" },
        { id: "A-diamonds", rank: "A", suit: "diamonds" },
        { id: "J-diamonds", rank: "J", suit: "diamonds" },
        { id: "9-diamonds", rank: "9", suit: "diamonds" },
        { id: "2-diamonds", rank: "2", suit: "diamonds" },
        { id: "8-clubs", rank: "8", suit: "clubs" },
        { id: "5-clubs", rank: "5", suit: "clubs" },
        { id: "2-clubs", rank: "2", suit: "clubs" }
      ]
    }
  };
}

function mockDealerDecisionState(roomToken: string) {
  const state = mockDesktopBottomSeatState(roomToken);
  const dealer = { id: "p0", name: "Dealer", isHost: true, isBot: false, seat: 0 };

  state.me = dealer;
  state.isHost = true;
  state.players[0] = dealer;
  state.seats[0] = { seat: 0, team: 0, player: dealer, cardCount: 9 };
  state.availableActions = [
    { type: "take-one", label: "Take one" },
    { type: "run-cards", label: "Run the cards" }
  ];
  state.game.phase = "dealer-decision";
  state.game.dealerSeat = 0;
  state.game.turnSeat = null;

  return state;
}
