/** Panel Hudba: nahrání vlastních skladeb, výběr pro menu (jedna) a playlist pro bitvu (více). */
import { h, clear } from "./dom.ts";
import { icon, label } from "./icons.ts";
import { addFiles, allTracks, currentTrackName, getMusicSettings, onLibraryChange, removeFile, setMenuTrack, setMusicVolume, toggleGameTrack, type Track } from "./music.ts";
import { getVolume, isMuted, setMuted, setVolume, sfx } from "./sound.ts";

export function renderMusicPanel(root: HTMLElement, onClose: () => void): () => void {
  const draw = () => {
    clear(root);
    const st = getMusicSettings();
    const rows = allTracks().map((t: Track) =>
      h(
        "div",
        { class: `mu-row ${currentTrackName() === t.name ? "playing" : ""}` },
        h("label", { class: "mu-cell", title: "Hraje v hlavním menu / místnosti" }, h("input", { type: "radio", name: "mu-menu", checked: st.menuTrackId === t.id, onchange: () => (sfx("click"), setMenuTrack(t.id)) })),
        h("label", { class: "mu-cell", title: "Součást playlistu v bitvě (hraje popořadě)" }, h("input", { type: "checkbox", checked: st.gameTrackIds.includes(t.id), onchange: (e) => (sfx("click"), toggleGameTrack(t.id, (e.target as HTMLInputElement).checked)) })),
        h("span", { class: "mu-name txt" }, t.kind === "synth" ? icon("play", "#7dd3fc", 10) : icon("log", "#94a3b8", 10), " ", t.name, currentTrackName() === t.name ? h("span", { class: "mu-now" }, label(" · hraje")) : null),
        t.kind === "file" ? h("button", { class: "px tiny", title: "Odebrat z knihovny", onclick: () => void removeFile(t.id) }, "✕") : h("span", { class: "muted", style: "font-size:10px" }, label("vestavěná")),
      ),
    );
    const upload = h("input", { type: "file", accept: "audio/*,.mp3,.ogg,.wav,.m4a", multiple: true, style: "display:none", onchange: (e) => { const inp = e.target as HTMLInputElement; if (inp.files?.length) void addFiles(inp.files); inp.value = ""; } });
    root.append(
      h(
        "div",
        { class: "pnl mu-card" },
        h("div", { class: "bb-head" }, icon("log", "#7dd3fc", 14), h("span", { class: "ttl" }, label("Hudba a zvuk")), h("button", { class: "px tiny", style: "margin-left:auto", onclick: onClose }, "✕")),
        h(
          "div",
          { class: "mu-vol" },
          h("span", {}, label("Hudba")),
          h("input", { type: "range", min: "0", max: "100", value: String(Math.round(st.volume * 100)), oninput: (e) => setMusicVolume(Number((e.target as HTMLInputElement).value) / 100) }),
          h("span", {}, label("Efekty")),
          h("input", { type: "range", min: "0", max: "100", value: String(Math.round(getVolume() * 100)), oninput: (e) => setVolume(Number((e.target as HTMLInputElement).value) / 100), onchange: () => sfx("laser") }),
          h("label", { class: "txt" }, h("input", { type: "checkbox", checked: isMuted(), onchange: (e) => setMuted((e.target as HTMLInputElement).checked) }), " ztlumit vše (M)"),
        ),
        h("div", { class: "mu-head" }, h("span", { class: "mu-cell", title: "Hlavní menu" }, label("menu")), h("span", { class: "mu-cell", title: "Playlist v bitvě" }, label("bitva")), h("span", { class: "mu-name" }, label("skladba"))),
        ...rows,
        h("div", { class: "row", style: "gap:8px;margin-top:8px;align-items:center" }, upload, h("button", { class: "px", onclick: () => upload.click() }, icon("inventory", "currentColor", 10), " ", label("nahrát vlastní skladby")), h("span", { class: "muted txt" }, "mp3 / ogg / wav · ukládá se jen v tomto prohlížeči")),
      ),
    );
  };
  draw();
  const off = onLibraryChange(draw);
  return () => off();
}
