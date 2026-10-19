import { MAX_TEAMS_TDM, TEAM_COLORS, TEAM_NAMES, type RoomState, type RoomSummary } from "@spacegame/shared";
import { clear, h } from "./dom.ts";
import { icon, label } from "./icons.ts";
import type { Net } from "./net.ts";

export interface LobbyModel {
  playerId: string;
  name: string;
  rooms: RoomSummary[];
  room: RoomState | null;
  error: string;
  connected: boolean;
}

/** Rozepsané hodnoty formulářů – přežijí překreslení při každé zprávě ze serveru. */
const drafts = { name: null as string | null, roomName: "", code: "" };

export function renderLobby(root: HTMLElement, m: LobbyModel, net: Net, setName: (n: string) => void) {
  const activeId = (document.activeElement as HTMLElement | null)?.id;
  const selStart = (document.activeElement as HTMLInputElement | null)?.selectionStart ?? null;
  clear(root);
  root.append(
    h("div", { class: `status ${m.connected ? "ok" : "bad"}` }, m.connected ? "ONLINE" : "OFFLINE..."),
    h(
      "div",
      { class: "screen" },
      h("div", { class: "center" }, h("div", { class: "title" }, h("h1", {}, "SPACEGAME"), h("div", { class: "sub" }, label("tahová vesmírná střílečka · prototyp"))), m.room ? roomView(m, net) : lobbyView(m, net, setName)),
    ),
  );
  if (activeId) {
    const el = document.getElementById(activeId) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (selStart !== null && typeof el.setSelectionRange === "function") {
        try {
          el.setSelectionRange(selStart, selStart);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function lobbyView(m: LobbyModel, net: Net, setName: (n: string) => void) {
  const nameInput = h("input", { id: "in-name", value: drafts.name ?? m.name, maxLength: 20, placeholder: "Tvoje jméno" });
  nameInput.oninput = () => (drafts.name = nameInput.value);
  const commitName = () => {
    const n = nameInput.value.trim();
    drafts.name = null;
    if (n && n !== m.name) {
      setName(n);
      net.send({ type: "setName", name: n });
    }
  };
  nameInput.onblur = commitName;
  nameInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      commitName();
      nameInput.blur();
    }
  };

  const roomName = h("input", { id: "in-room", value: drafts.roomName, placeholder: "Název místnosti (nepovinný)", maxLength: 20 });
  roomName.oninput = () => (drafts.roomName = roomName.value);
  const codeInput = h("input", { id: "in-code", value: drafts.code, placeholder: "KÓD", maxLength: 4, style: "width:90px;text-transform:uppercase;letter-spacing:2px" });
  codeInput.oninput = () => (drafts.code = codeInput.value);
  const join = () => codeInput.value.trim() && (commitName(), net.send({ type: "joinRoom", code: codeInput.value.trim().toUpperCase() }));
  codeInput.onkeydown = (e) => e.key === "Enter" && join();

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h("div", { class: "card" }, h("h3", {}, label("Pilot")), h("div", { class: "row" }, nameInput, h("span", { class: "muted txt" }, "jméno uvidí ostatní hráči"))),
    h(
      "div",
      { class: "card" },
      h("h3", {}, label("Nová místnost")),
      h(
        "div",
        { class: "row" },
        roomName,
        h("button", { class: "primary", onclick: () => (commitName(), net.send({ type: "createRoom", name: roomName.value })) }, label("Vytvořit místnost")),
      ),
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "row" }, h("h3", {}, label("Otevřené místnosti")), h("div", { class: "spacer" }), codeInput, h("button", { onclick: join }, label("Připojit kódem"))),
      m.rooms.length === 0
        ? h("div", { class: "muted txt", style: "padding:8px 0" }, "Zatím žádná místnost. Vytvoř první!")
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
                r.inGame ? h("span", { class: "muted" }, label("hra probíhá")) : h("button", { onclick: () => (commitName(), net.send({ type: "joinRoom", code: r.code })) }, label("Připojit")),
              ),
            ),
          ),
      h("div", { class: "error" }, m.error),
    ),
    h(
      "div",
      { class: "card muted txt" },
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
      h("h3", {}, label(TEAM_NAMES[team])),
      ...members.map((p) =>
        h(
          "div",
          { class: "player" },
          h("span", { class: `dot ${p.connected ? "" : "off"}` }),
          h("span", {}, p.name),
          p.id === room.hostId ? h("span", { class: "host" }, "HOST") : null,
          p.isBot && isHost ? h("button", { class: "x", onclick: () => net.send({ type: "removeBot", botId: p.id }) }, "✕") : null,
        ),
      ),
      h(
        "div",
        { class: "row", style: "margin-top:8px" },
        me?.team !== team ? h("button", { onclick: () => net.send({ type: "setTeam", team }) }, label("Přejít sem")) : null,
        isHost ? h("button", { onclick: () => net.send({ type: "addBot", team }) }, icon("bot", "currentColor", 12), label("bot")) : null,
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
        h("span", { class: "muted" }, "KOD "),
        h("span", { class: "code", style: "font-size:22px;font-weight:700;color:var(--accent);letter-spacing:3px" }, room.code),
        h("div", { class: "spacer" }),
        h("button", { onclick: () => net.send({ type: "leaveRoom" }) }, label("Opustit")),
      ),
      h("div", { class: "muted txt" }, "Řekni kód ostatním, nebo ať místnost najdou v seznamu."),
    ),
    tdm
      ? h("div", { class: "teams" }, ...Array.from({ length: MAX_TEAMS_TDM }, (_, i) => teamBox(i)))
      : h(
          "div",
          { class: "card" },
          h("h3", {}, label("Hráči (každý sám za sebe)")),
          ...room.players.map((p, i) =>
            h(
              "div",
              { class: "player" },
              h("span", { class: `dot ${p.connected ? "" : "off"}` }),
              h("span", { style: `color:${TEAM_COLORS[i % TEAM_COLORS.length]}` }, p.name),
              p.id === room.hostId ? h("span", { class: "host" }, "HOST") : null,
              p.isBot && isHost ? h("button", { class: "x", onclick: () => net.send({ type: "removeBot", botId: p.id }) }, "✕") : null,
            ),
          ),
          isHost ? h("div", { class: "row", style: "margin-top:8px" }, h("button", { onclick: () => net.send({ type: "addBot", team: 0 }) }, icon("bot", "currentColor", 12), label("bot"))) : null,
        ),
    h(
      "div",
      { class: "card settings" },
      h("h3", {}, label("Nastavení bitvy"), isHost ? "" : label(" (mění host)")),
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
      h("div", { class: "muted txt", style: "margin-top:6px" }, "Při limitu kol vyhrává tým s největším součtem zbývajícího trupu a štítů."),
    ),
    h(
      "div",
      { class: "row" },
      h("div", { class: "error" }, m.error),
      h("div", { class: "spacer" }),
      isHost ? h("button", { class: "primary", onclick: () => net.send({ type: "startGame" }) }, icon("play", "currentColor", 12), label("Zahájit bitvu")) : h("span", { class: "muted txt" }, "Čeká se, až host zahájí bitvu…"),
    ),
  );
}
