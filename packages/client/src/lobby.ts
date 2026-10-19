import { MAX_TEAMS_TDM, TEAM_COLORS, TEAM_NAMES, type RoomState, type RoomSummary } from "@spacegame/shared";
import { clear, h } from "./dom.ts";
import type { Net } from "./net.ts";

export interface LobbyModel {
  playerId: string;
  name: string;
  rooms: RoomSummary[];
  room: RoomState | null;
  error: string;
  connected: boolean;
}

export function renderLobby(root: HTMLElement, m: LobbyModel, net: Net, setName: (n: string) => void) {
  clear(root);
  root.append(
    h("div", { class: `status ${m.connected ? "ok" : "bad"}` }, m.connected ? "připojeno" : "odpojeno – připojuji…"),
    h(
      "div",
      { class: "screen" },
      h("div", { class: "center" }, h("div", { class: "title" }, h("h1", {}, "SPACEGAME"), h("div", { class: "sub" }, "tahová vesmírná střílečka · prototyp v1")), m.room ? roomView(m, net) : lobbyView(m, net, setName)),
    ),
  );
}

function lobbyView(m: LobbyModel, net: Net, setName: (n: string) => void) {
  const nameInput = h("input", { value: m.name, maxLength: 20, placeholder: "Tvoje jméno" });
  const commitName = () => {
    const n = nameInput.value.trim();
    if (n && n !== m.name) {
      setName(n);
      net.send({ type: "setName", name: n });
    }
  };
  nameInput.onblur = commitName;
  nameInput.onkeydown = (e) => e.key === "Enter" && commitName();

  const roomName = h("input", { placeholder: "Název místnosti (nepovinný)", maxLength: 20 });
  const codeInput = h("input", { placeholder: "KÓD", maxLength: 4, style: "width:90px;text-transform:uppercase;letter-spacing:2px" });
  const join = () => codeInput.value.trim() && (commitName(), net.send({ type: "joinRoom", code: codeInput.value.trim().toUpperCase() }));
  codeInput.onkeydown = (e) => e.key === "Enter" && join();

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h("div", { class: "card" }, h("h3", {}, "Pilot"), h("div", { class: "row" }, nameInput, h("span", { class: "muted" }, "jméno uvidí ostatní hráči"))),
    h(
      "div",
      { class: "card" },
      h("h3", {}, "Nová místnost"),
      h(
        "div",
        { class: "row" },
        roomName,
        h("button", { class: "primary", onclick: () => (commitName(), net.send({ type: "createRoom", name: roomName.value })) }, "Vytvořit místnost"),
      ),
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "row" }, h("h3", {}, "Otevřené místnosti"), h("div", { class: "spacer" }), codeInput, h("button", { onclick: join }, "Připojit kódem")),
      m.rooms.length === 0
        ? h("div", { class: "muted", style: "padding:8px 0" }, "Zatím žádná místnost. Vytvoř první!")
        : h(
            "div",
            { class: "room-list" },
            ...m.rooms.map((r) =>
              h(
                "div",
                { class: "room-item" },
                h("span", { class: "code" }, r.code),
                h("span", {}, r.name),
                h("span", { class: "muted" }, `${r.players} hráčů`),
                h("div", { class: "spacer" }),
                r.inGame ? h("span", { class: "muted" }, "hra probíhá") : h("button", { onclick: () => (commitName(), net.send({ type: "joinRoom", code: r.code })) }, "Připojit"),
              ),
            ),
          ),
      h("div", { class: "error" }, m.error),
    ),
    h(
      "div",
      { class: "card muted", style: "font-size:12px" },
      "Hráči na stejné síti otevřou stejnou adresu jako ty (viz výpis serveru). Místnosti vidí všichni, kód slouží k přímému připojení.",
    ),
  );
}

function roomView(m: LobbyModel, net: Net) {
  const room = m.room!;
  const isHost = room.hostId === m.playerId;
  const me = room.players.find((p) => p.id === m.playerId);
  const tdm = room.settings.mode === "tdm";

  const teamBox = (team: number) => {
    const members = room.players.filter((p) => p.team === team);
    return h(
      "div",
      { class: `team ${me?.team === team ? "mine" : ""}`, style: `--team:${TEAM_COLORS[team]}` },
      h("h3", {}, TEAM_NAMES[team]),
      ...members.map((p) =>
        h(
          "div",
          { class: "player" },
          h("span", { class: `dot ${p.connected ? "" : "off"}` }),
          h("span", {}, p.name),
          p.id === room.hostId ? h("span", { class: "host" }, "host") : null,
          p.isBot && isHost ? h("button", { class: "x", onclick: () => net.send({ type: "removeBot", botId: p.id }) }, "✕") : null,
        ),
      ),
      h(
        "div",
        { class: "row", style: "margin-top:8px" },
        me?.team !== team ? h("button", { onclick: () => net.send({ type: "setTeam", team }) }, "Přejít sem") : null,
        isHost ? h("button", { onclick: () => net.send({ type: "addBot", team }) }, "+ bot") : null,
      ),
    );
  };

  const settings = room.settings;
  const set = (patch: Partial<typeof settings>) => net.send({ type: "setSettings", settings: patch });

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("h2", {}, room.name),
        h("span", { class: "muted" }, "kód: "),
        h("span", { class: "code", style: "font-size:22px;font-weight:700;color:var(--accent);letter-spacing:3px" }, room.code),
        h("div", { class: "spacer" }),
        h("button", { onclick: () => net.send({ type: "leaveRoom" }) }, "Opustit"),
      ),
      h("div", { class: "muted", style: "font-size:12px" }, "Řekni kód ostatním, nebo ať místnost najdou v seznamu."),
    ),
    tdm
      ? h("div", { class: "teams" }, ...Array.from({ length: MAX_TEAMS_TDM }, (_, i) => teamBox(i)))
      : h(
          "div",
          { class: "card" },
          h("h3", {}, "Hráči (každý sám za sebe)"),
          ...room.players.map((p, i) =>
            h(
              "div",
              { class: "player" },
              h("span", { class: `dot ${p.connected ? "" : "off"}` }),
              h("span", { style: `color:${TEAM_COLORS[i % TEAM_COLORS.length]}` }, p.name),
              p.id === room.hostId ? h("span", { class: "host" }, "host") : null,
              p.isBot && isHost ? h("button", { class: "x", onclick: () => net.send({ type: "removeBot", botId: p.id }) }, "✕") : null,
            ),
          ),
          isHost ? h("div", { class: "row", style: "margin-top:8px" }, h("button", { onclick: () => net.send({ type: "addBot", team: 0 }) }, "+ bot")) : null,
        ),
    h(
      "div",
      { class: "card settings" },
      h("h3", {}, "Nastavení bitvy", isHost ? "" : " (mění host)"),
      h(
        "label",
        {},
        h("span", {}, "Herní mód"),
        h(
          "select",
          { disabled: !isHost, onchange: (e) => set({ mode: (e.target as HTMLSelectElement).value as "tdm" | "dm" }) },
          h("option", { value: "tdm", selected: settings.mode === "tdm" }, "Týmový deathmatch"),
          h("option", { value: "dm", selected: settings.mode === "dm" }, "Deathmatch (všichni proti všem)"),
        ),
      ),
      h(
        "label",
        {},
        h("span", {}, "Limit kol"),
        h(
          "select",
          { disabled: !isHost, onchange: (e) => set({ turnLimit: Number((e.target as HTMLSelectElement).value) }) },
          ...[0, 10, 15, 20, 30, 40].map((n) => h("option", { value: String(n), selected: settings.turnLimit === n }, n === 0 ? "bez limitu" : `${n} kol`)),
        ),
      ),
      h(
        "label",
        {},
        h("span", {}, "Lodí na hráče"),
        h(
          "select",
          { disabled: !isHost, onchange: (e) => set({ shipsPerPlayer: Number((e.target as HTMLSelectElement).value) }) },
          ...[1, 2, 3, 4].map((n) => h("option", { value: String(n), selected: settings.shipsPerPlayer === n }, String(n))),
        ),
      ),
      h("div", { class: "muted", style: "font-size:12px;margin-top:6px" }, "Při limitu kol vyhrává tým s největším součtem zbývajícího trupu a štítů."),
    ),
    h(
      "div",
      { class: "row" },
      h("div", { class: "error" }, m.error),
      h("div", { class: "spacer" }),
      isHost ? h("button", { class: "primary", onclick: () => net.send({ type: "startGame" }) }, "Zahájit bitvu") : h("span", { class: "muted" }, "Čeká se, až host zahájí bitvu…"),
    ),
  );
}
