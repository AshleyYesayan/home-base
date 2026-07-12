/* Home Base — smoke test
 *
 * Read-only. Never writes to the database.
 * Run in the browser console on https://ashleyyesayan.github.io/home-base/ while
 * signed in, AFTER every deploy. It should print ALL PASS.
 *
 *   1. paste this whole file into the console
 *   2. await smokeTest()
 */
async function smokeTest() {
  const results = [];
  const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || "" });

  const errors = [];
  const onErr = (e) => errors.push(e.message || String(e));
  window.addEventListener("error", onErr);
  window.addEventListener("unhandledrejection", onErr);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- 1. the app booted ---------- */
  ok("globals: sb (supabase client)", typeof sb !== "undefined" && !!sb);
  ok("globals: DATA", typeof DATA !== "undefined" && !!DATA);
  ok("globals: MY_ID is set", typeof MY_ID !== "undefined" && !!MY_ID);
  ok("globals: MEMBERS loaded", typeof MEMBERS !== "undefined" && MEMBERS.length > 0,
     typeof MEMBERS !== "undefined" ? MEMBERS.length + " member(s)" : "");

  /* ---------- 2. no personal data baked into the build ----------
     The original seed() shipped Ashley's real routine (medication reminders and
     all) to every new household. Never let that back in. */
  const src = await (await fetch(location.pathname + "?cb=" + Date.now(), { cache: "no-store" })).text();
  const leaks = ["Wegovy", "orchid", "birdseed", "Dispensary", "front and side porch"]
    .filter((w) => new RegExp(w, "i").test(src));
  ok("no personal seed data in bundle", leaks.length === 0, leaks.join(", "));

  /* ---------- 3. seed cannot recurse ----------
     loadAll() calls seed() when every table is empty. If seed() calls loadAll()
     back and its inserts fail, that is an infinite loop. */
  const seedSrc = (src.match(/async function seed\(\)[\s\S]*?\n\}/) || [""])[0];
  ok("seed() does not call loadAll() (infinite-loop guard)", !/loadAll\(\)/.test(seedSrc));

  /* ---------- 4. every dashboard widget has a builder and a title ---------- */
  const declared = (src.match(/const DASH_DEFAULT = \[(.*?)\]/) || ["", ""])[1]
    .split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
  // Brace-match the object literal. A fixed-size window silently truncates and
  // reports false failures for whichever keys fall off the end.
  const objAfter = (marker) => {
    const i = src.indexOf(marker);
    if (i < 0) return "";
    let depth = 0;
    for (let j = src.indexOf("{", i); j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(i, j + 1); }
    }
    return "";
  };
  const builderKeys = objAfter("const builders = {");
  const titleKeys = objAfter("const titles = {");
  const missing = declared.filter((k) => !new RegExp("\\b" + k + "\\s*:").test(builderKeys));
  const untitled = declared.filter((k) => !new RegExp("\\b" + k + "\\s*:").test(titleKeys));
  ok("every DASH_DEFAULT widget has a builder", missing.length === 0, missing.join(", "));
  ok("every DASH_DEFAULT widget has a title", untitled.length === 0, untitled.join(", "));

  /* ---------- 5. all four tabs render without throwing ---------- */
  for (const t of ["today", "tasks", "pantry", "meal"]) {
    const btn = document.querySelector('[data-v="' + t + '"]');
    if (!btn) { ok("tab renders: " + t, false, "tab button missing"); continue; }
    const before = errors.length;
    btn.click();
    await sleep(350);
    ok("tab renders: " + t, errors.length === before);
  }

  /* ---------- 6. sub-tabs render ---------- */
  for (const b of [...document.querySelectorAll("nav.subtabs button")]) {
    const before = errors.length;
    b.click();
    await sleep(200);
    ok("subtab renders: " + (b.textContent || "").trim(), errors.length === before);
  }

  /* ---------- 7. store links ---------- */
  document.querySelector('[data-v="pantry"]').click();
  await sleep(400);
  const links = [...document.querySelectorAll("#pane-supplies a")];
  const ic = links.filter((a) => /instacart\.com/.test(a.href));
  const az = links.filter((a) => /amazon\.com/.test(a.href));
  ok("Instacart links present", ic.length > 0, ic.length + " link(s)");
  // Retailer-scoped URLs (/store/<slug>/s) hard-block behind an Instacart login.
  ok("Instacart links are NOT retailer-scoped (would hit a login wall)",
     ic.every((a) => !/^\/store\/[a-z0-9-]+\/s/.test(new URL(a.href).pathname)));
  // Search links use ?tag=; the multi-item cart endpoint uses ?AssociateTag=. Both valid.
  ok("Amazon links carry the affiliate tag",
     az.length === 0 || az.every((a) => /[?&](tag|AssociateTag)=/.test(a.href)));
  // iOS blocks window.open inside an installed PWA, so these must be real anchors.
  ok("store links are real anchors with target=_blank (iOS PWA)",
     [...ic, ...az].every((a) => a.tagName === "A" && a.target === "_blank"));

  /* ---------- 8. assignment UI ---------- */
  document.querySelector('[data-v="tasks"]').click();
  await sleep(400);
  ok("assignee chips render", document.querySelectorAll(".who").length > 0,
     document.querySelectorAll(".who").length + " chip(s)");
  ok("Mine/Everyone filter renders", !!document.getElementById("taskFilterBar"));

  /* ---------- 9. push plumbing ---------- */
  ok("VAPID public key present", /VAPID_PUBLIC\s*=\s*"B/.test(src));
  ok("push button present", !!document.getElementById("pushBtn"));
  ok("service worker registered", !!(await navigator.serviceWorker.getRegistration()));

  /* ---------- 10. RLS: nothing from another household is visible ---------- */
  const { data: hm } = await sb.from("household_members").select("household_id");
  const mine = [...new Set((hm || []).map((r) => r.household_id))];
  const scoped = ["recurring_tasks", "weekly_tasks", "handyman_tasks", "reminders",
                  "pantry_items", "freezer_meals", "meal_plan", "meal_history", "task_templates"];
  let foreign = 0;
  for (const t of scoped) {
    const { data } = await sb.from(t).select("household_id");
    foreign += (data || []).filter((r) => r.household_id && !mine.includes(r.household_id)).length;
  }
  ok("RLS: zero rows visible from other households", foreign === 0, foreign + " leaked");

  /* ---------- report ---------- */
  window.removeEventListener("error", onErr);
  window.removeEventListener("unhandledrejection", onErr);
  ok("no uncaught JS errors during run", errors.length === 0, errors.join(" | "));

  const failed = results.filter((r) => !r.pass);
  console.table(results.map((r) => ({ "": r.pass ? "PASS" : "FAIL", test: r.name, detail: r.detail })));
  console.log(failed.length === 0
    ? "ALL PASS (" + results.length + " checks)"
    : failed.length + " FAILED of " + results.length);
  return { total: results.length, failed: failed.length, failures: failed };
}
