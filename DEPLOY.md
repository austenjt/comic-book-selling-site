# Deployment Log — Lightning Comics (claim sale)

A running record of what has actually been created/deployed in Azure for this project. The
step-by-step *how-to* guides live next to the code they deploy:

- [`comic-book-db/DEPLOY.md`](comic-book-db/DEPLOY.md) — how to build and publish the Static Web App.
- [`fn-comic-db/DEPLOY.md`](fn-comic-db/DEPLOY.md) — how to provision and deploy the Function App.

Those files describe *how* to do it. This file records *what we actually did and when*.

## Azure resources

Subscription `my-subscription` (`00000000-0000-0000-0000-000000000000`), resource group `my-resource-group`.

| Resource | Name | Notes |
|---|---|---|
| Function App | `your-function-app` | **Windows** consumption, Java 17, `your-function-app.azurewebsites.net` |
| Static Web App | `comic-book-db` | Free tier, `your-static-web-app.azurestaticapps.net` |
| Custom domain | `example.com` + `www.example.com` | Both Ready since 2026-03-12 |
| Cosmos DB | database `comic-db` | Nine containers — see `CLAUDE.md` |

**The production domain for this app is `example.com`.** Noted because it was previously
an open question, and because `comic-book-db/DEPLOY.md` still shows a `--base-href` pointing at the
`lemon-pebble-…azurestaticapps.net` default host. The authoritative build command is the `build`
script in `package.json`, which correctly uses `https://example.com/`.

## Log

- **2026-09-24** — **re-deployed both halves to production as a one-time route verification**,
  repeating a verification previously done for another site. No code change: this shipped
  `dee2a48` — *"Fix image generation."* — which was already what production was running. The point
  was to prove a build-and-deploy to production can be driven end to end from an automated agent interface, not to release anything.
  - **Precondition checked first, and it is the whole reason this was safe.** `main` was identical
    to `origin/main` (0 ahead / 0 behind) with a clean tree, HEAD authored 2026-08-30T22:35:09Z,
    and the **active** entry in the Function App's deployment history is 2026-08-30T22:35:58Z — a
    deploy **49 seconds** after that commit. Same code in both places, so a re-deploy could not
    ship unreviewed work. **If you repeat this test later, re-check that pairing first;** once
    `main` drifts ahead of the active deployment, this stops being a free test and becomes a
    release.
  - Unlike the Linux Function Apps on the other two sites, this one is **Windows**, and its
    `/deployments` API *does* return a real history — so here you can read the deploy date
    directly instead of decoding a package blob name. Worth knowing which site is which.
  - **The frontend precondition was proved by content hash.** `npm run build` produced
    `main-MEZUSVJV.js`, `polyfills-5CFQRCPP.js` and `styles-W4FCC724.css`, all three matching what
    `example.com` was already serving. Angular's hashes are content-derived, so matching
    filenames mean identical bytes.
  - **Build this on the laptop default JDK (Temurin 25). Do not install another JDK.** This deploy
    got it wrong: it ran `sdk install java 17.0.20-tem` and pinned `JAVA_HOME` to it, reasoning that
    because `pom.xml` uses `<source>/<target>` 17 — *not* `maven.compiler.release` — compiling on a
    newer JDK would link against that JDK's class library and could emit code referencing methods
    absent from 17. **That was corrected on 2026-09-24 and the JDK 17 install was removed.** The
    owner's standing rule is that the laptop default Temurin 25 is the known-good build JDK for all
    three sites, and it was verified here directly: `mvn clean package` on 25.0.3 gives **BUILD
    SUCCESS, 73 tests, 0 failures**, and the emitted classes are **major version 61 — correct Java
    17 bytecode**. Altering this machine's Java installation is not this repo's business.
  - The one real artifact of the `<source>/<target>` style is a javac warning: `location of system
    modules is not set in conjunction with -source 17`. It means javac targets 17 bytecode while
    resolving APIs against JDK 25's class library, so the mismatch is theoretically reachable even
    though nothing in this codebase hits it. **Do not "fix" it by installing a JDK.** The correct
    fix, if ever wanted, is one line in `pom.xml` — replace `<source>`/`<target>` with
    `<maven.compiler.release>17</maven.compiler.release>`, which makes javac link against the real
    Java 17 API. That is a code change, needs its own issue and review, and is not required for
    deploys to be correct today.
  - `mvn clean package` — **73 tests, 0 failures**. Build was kept separate from deploy so nothing
    reached Azure until it was green.
  - Timings: backend deploy 82s (slower than the Linux sites' ~30s), frontend publish 22s. New
    active deployment 2026-09-25T00:36:15Z.
  - **Smoke test passed.** `/api/config` → 200; `/api/comics` → 200 returning ~980 KB of catalogue,
    so the Cosmos path was exercised rather than just the host. `example.com` → 200 in
    0.39s, `/trade-board` and `/documentation` → 200 (SPA fallback intact), `www.` → 200,
    `/sitemap.xml` → 200, and the served `main-MEZUSVJV.js` matched the locally built filename.
  - **Cold start is real on this app and worth expecting.** The first `/api/comics` after the
    restart took **38 seconds**; the same call warm took 0.84s and `/api/config` 0.13s. A Windows
    consumption plan returning a ~1 MB payload is the slowest first-request of the three sites.
  - **One 404 that is not a regression.** `/api/enums` returns 404. `CLAUDE.md` lists an
    `EnumTriggers` class serving it, but no `EnumTriggers.java` exists in the repo — that job was
    folded into `ConfigTriggers`, which serves feature flags *and* enum values at `/api/config`.
    The doc is stale; the code is correct. Do not go looking for a broken route.
  - Conclusion: **this route works.** Deploying to production from the agent interface is a proven
    option for this site. No workflow file, no automation, and no credentials were created.

### Open items noted during this deploy, not changed

- **`comic-book-db/.github/workflows/azure-static-web-apps-your-static-web-app.yml` is dead and
  should probably be deleted.** It targets a Static Web App (`your-static-web-app`) that no longer
  exists in the subscription, and its `api_location` is set to a URL pointing at
  `your-function-app` — also gone — where that field expects a repo path. It is
  currently **inert** only because GitHub Actions reads workflows from the *repository root*
  `.github/workflows`, and this one sits one directory down under `comic-book-db/`. If the repo is
  ever restructured so that directory becomes the root, this would start firing push-triggered
  deploys with a stale token. Left in place because deleting it is outside a no-op deploy test.
- `httpsOnly` is **false** on the Function App, so it will answer plaintext http if asked.
- `src/sitemap.xml` is **generated at build time from the live API** (`scripts/generate-sitemap.mjs`
  fetches every comic), so the copy committed to git goes stale as the catalogue changes and the
  build rewrites it every run. This deploy regenerated it — one comic dropped, one added — and
  production now has the current list while git still holds the older snapshot. The working-tree
  change was reverted to keep the tree clean for the next precondition check. This is by design,
  but it does mean **this repo's frontend build is not byte-reproducible**; the JS/CSS hashes are,
  which is what the precondition check above actually relies on.

## 2026-09-25 — real Maven Wrapper added to `fn-comic-db`

No application code, no `pom.xml` compiler setting, and no Azure resource changed.

- **The problem.** This repo had no Maven Wrapper at all. `mvn` reached `PATH` only through SDKMAN
  in `~/.zshrc`, which zsh reads for interactive shells only, so any script, cron job, or CI runner
  got `command not found: mvn`.
- **The fix.** `mvn wrapper:wrapper -Dmaven=3.9.16` in `fn-comic-db/`, committing `mvnw`,
  `mvnw.cmd`, and `.mvn/wrapper/maven-wrapper.properties`. `./mvnw` is now the supported build
  entry point; the wrapper pins Maven 3.9.16 and needs nothing on `PATH` but a JDK.
- **Verified headlessly.** `env -i HOME=$HOME /bin/zsh -c 'cd fn-comic-db && ./mvnw clean package'`
  → **BUILD SUCCESS, 73 tests, 0 failures**, on the clean-shell JDK (Temurin 25.0.2). This is the
  same "build on the laptop default JDK, do not install a 17" conclusion recorded above, now shown
  to hold with no profile inherited: the pom's `source`/`target` of 17 still emits major version 61.
- **A second headless gap, not Maven's.** `azure-functions:package` shells out to `func`, so Core
  Tools v4 must be on `PATH` or the build fails *after* the tests pass. It sits at
  `/usr/local/bin/func`, which the default clean shell can see; a CI runner cannot, and needs an
  explicit Core Tools install step.
- Rollback is `git revert` of the wrapper commit; manual deploys are unaffected either way.
