# Research: integrations, MCP, and differentiation

_Researched 2026-11-17. Desk research only, no implementation. Prices change a lot and the sources often disagree. Where they conflict, both figures are given. **UNVERIFIED** marks a claim backed by a single secondary source or by my own inference._

**Access limits during research.** Reddit could not be searched (`reddit.com` is blocked for the search user agent). These hosts were not on this session's network allowlist and could not be fetched directly: `developers.notion.com`, `mystudylife.com`, `dormway.app`, `glama.ai`. Their content was seen only through search-result summaries. `registry.modelcontextprotocol.io` and `claude.com/connectors` were reachable and were queried directly. Student-complaint evidence therefore comes from Capterra, App Store snippets, student newspapers and blogs. Many of those blogs are written by competitors (DormWay, Morgen, Saner, RecipeSage) and are flagged as such.

---

## 0. TL;DR verdict on the hypothesis

> "The main thing that sets this apart could be ease of connectivity with MCPs and other services."

**Mostly wrong as stated. It is right in one narrow way.**

1. **Exposing an MCP server is not a moat. It is fast becoming table stakes, and incumbents already have it.** Notion (`mcp.notion.com`), Todoist (`ai.todoist.net/mcp`), Akiflow and (per a third-party listing) Reclaim all ship **official, hosted** MCP servers. A student with any free Notion template plus Notion's MCP already has an "AI-connected planner" today, for $0. Claude also ships built-in Google Calendar and Gmail connectors, and Google now runs its own Workspace MCP servers. Every event Petal already pushes to Google Calendar is therefore AI-readable today, with zero MCP work.
2. **The integration students actually value is consuming their LMS, and that is not MCP.** It means plain ICS feeds, REST and OAuth. It is also where the real hard problems are: CORS, per-institution Canvas developer keys, and refresh tokens. Shovel, Coursicle, DormWay and "Canvas Sync for Notion" already compete on it, so being first is not the edge. The edge is doing it with no setup, inside a planner that also does grades and life.
3. **MCP fights the architecture.** A remote MCP server (the only kind claude.ai, ChatGPT and phones can use) needs the user's data on a server you run, plus OAuth. Petal today is per-browser IndexedDB with no backend. Making MCP real first requires accounts and sync. That backend is worth building anyway (phone sync, Google refresh tokens), but it is the real project, and MCP is a small add-on on top.
4. **The audience that configures custom connectors is small.** Claude Free allows **one** custom connector. ChatGPT custom MCP write actions are officially limited to Business, Enterprise and Edu, and Plus access is disputed. A student would have to find Petal among about 1,135 connectors in Claude's directory.
5. **Where it is right:** no incumbent holds a student's assignments, exams, grade weights, habits, meals, workouts and budget in one schema. A Petal MCP server could answer cross-domain questions ("I have a midterm Thursday, 3 assignments and gym 4×/week; plan my week and my grocery list") that no single Notion, Todoist or Canvas connector can. That makes it **a good retention feature for an existing user base, not an acquisition differentiator.** Build it after sync, and keep it small.

**What should be the differentiator instead:** *"Open it, paste your Canvas feed link, and your semester is planned (deadlines, exam countdowns, grade math, study blocks), on a phone, offline, with no template to build."* That claim beats Notion on the exact points students complain about. It is mostly plain APIs plus one small stateless proxy.

---

## 1. The key distinction: exposing vs consuming

| | (a) Petal **exposes** an MCP server | (b) Petal **consumes** other services |
|---|---|---|
| What it means | Claude, ChatGPT, Cursor etc. can read and write the user's planner | Petal pulls from or pushes to Canvas, Google, Spotify, health data, banks… |
| Protocol | MCP (remote: Streamable HTTP + OAuth; local: stdio) | Mostly REST, OAuth, ICS and webhooks. **Not MCP.** MCP servers are built for LLM clients, not for apps to call |
| Who benefits | Students who already live in an AI assistant | Every student: data appears without typing it |
| Competitors already doing it | Notion, Todoist, Akiflow, Reclaim (official servers) | Shovel, Coursicle, MyStudyLife(?), Canvas-Sync-for-Notion, DormWay (LMS); Notion Calendar (calendars) |
| Needs a backend? | **Yes** for remote MCP. A local stdio bridge works only for desktop power users | Depends on the service (table below) |

### What a local-first, no-backend architecture allows and prevents

| Integration | Browser-only feasible? | Blocker | Minimal infrastructure that fixes it |
|---|---|---|---|
| Google Calendar read/write (exists) | Yes | GIS token model gives **no refresh token**, so the user re-consents about hourly. Google's docs say offline or refresh access requires the **code model with a backend** ([Google: choose an authorization model](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model?authuser=6)) | Small auth backend that holds refresh tokens |
| Canvas / Brightspace / Moodle **ICS calendar feed** | Partly | Browser `fetch` of a feed on the LMS domain is likely CORS-blocked (**UNVERIFIED** per instance; Canvas sends no CORS headers for its API, see the next row). The feed omits Canvas "To Do" items and anything without a due date, and some schools disable it ([Canvas community](https://community.canvaslms.com/t5/Student-Guide/How-do-I-view-the-Calendar-iCal-feed-to-subscribe-to-an-external/ta-p/331), [UH KB](https://oituhcl.teamdynamix.com/TDClient/150/Portal/KB/ArticleDet?ID=4631)) | **Stateless CORS proxy** (for example a Cloudflare Worker about 30 lines long) that fetches the feed URL. No accounts, no stored data |
| Canvas **REST API** (grades, submissions) | No | (1) No CORS: a developer hit "blocked by CORS policy" and the workaround was a proxy ([Canvas community](https://community.canvaslms.com/t5/Canvas-Developers-Group/Javascript-API-Development-CORS-issue/td-p/571686)). (2) Multi-user apps **must use OAuth with a developer key issued by each institution's admin**. Asking users to paste personal tokens violates Canvas API policy ([CU Boulder Canvas OAuth doc](https://canvas.colorado.edu/doc/api/file.oauth.html), [Instructure docs](https://developerdocs.instructure.com/services/canvas/oauth)). (3) Many schools disable student tokens ([UM System](https://tdx.umsystem.edu/TDClient/66/MOOnline/KB/ArticleDet?ID=2302)) | A backend **plus** school-by-school developer-key deals. This is a sales motion, not code. Avoid for now |
| Google Classroom | Yes (Google APIs allow CORS) | Same 1-hour token issue. Workspace-for-Education admins can block unverified apps ([Google Classroom best practices](https://developers.google.com/classroom/best-practices/access-control-enhancements)). Scope verification is required for a public app | Auth backend plus Google verification |
| Gmail deadline extraction | Technically yes | `gmail.readonly` is a **restricted** scope, so a CASA security assessment is required, **renewed yearly**. Quotes range from about $550 to $75k ([Nylas guide](https://developer.nylas.com/docs/dev-guide/provider-guides/google/google-verification-security-assessment-guide), [GMass](https://www.gmass.co/blog/?p=9167)) | Not worth it. Users can already ask Claude's Gmail connector to do this |
| Outlook / iCloud calendars | Outlook: yes (MSAL SPA + PKCE, **UNVERIFIED** for refresh lifetimes). iCloud: no (CalDAV with an app-specific password, no CORS) | iCloud needs a server-side CalDAV client | Backend |
| Recipe import from URL | No | Recipe sites send no CORS headers | Same stateless proxy, then parse `schema.org/Recipe` JSON-LD |
| Spotify (focus playlists) | Yes (PKCE) | Low student value | None |
| Apple Health | **No** | HealthKit is iOS on-device only. There is no web API | Native iOS app |
| Google Fit | **No** | The Fit REST API is being **shut down in 2026 with no web replacement**. Health Connect is on-device Android only ([Android migration FAQ](https://developer.android.com/health-and-fitness/health-connect/migration/fit/faq), [Sahha](https://sahha.ai/blog/google-fit-api-sunset-migration/)). The Fitbit Web API turned off on Nov 2 2026, and its successor Google Health API uses only Restricted scopes ([Google Health API](https://developers.google.com/health/about?authuser=26)) | Native app or a paid aggregator (Terra etc.) |
| Strava | Technically yes (OAuth) | Nov 2024 terms: third parties may show data only to the owning user and **may not use Strava API data for AI or ML**. Tightened further in June 2026 ([TechCrunch](https://techcrunch.com/2026/06/01/strava-declares-war-on-scrapers-ahead-of-ipo), [DC Rainmaker](https://dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html), [Terra](https://tryterra.co/blog/strava-api-changes-2026)). **Piping Strava data to an LLM through a Petal MCP server would likely breach the terms** | Avoid |
| Hevy | Needs a key | API keys are **Pro-only** and per-user ([FitnessSyncer](https://www.fitnesssyncer.com/support/hevy), [Serval docs](https://docs.serval.com/sections/integrations/hevy)) | Optional per-user key. Niche |
| Banking (Plaid) | **No** | Needs a server-side secret, per-connection fees, compliance burden. Only sandbox-only MCP wrappers exist in the registry | Avoid. CSV import is the honest student-budget answer |
| Webhooks (Google push, LMS events) | **No** | Need a public HTTPS receiver | Backend |
| **Remote MCP server** | **No** | Claude and ChatGPT connect from their own servers to a public HTTPS URL; the data must live there | Sync backend + OAuth (see §5) |

---

## 2. MCP ecosystem survey (lifestyle and student relevant)

**Directories checked:** [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) (now only 7 reference servers: Everything, Fetch, Filesystem, Git, Memory, Sequential Thinking, Time. The old Google Drive reference server is **archived**). The [official MCP Registry](https://registry.modelcontextprotocol.io) was queried directly via its `/v0/servers` API. The [Claude connectors directory](https://claude.com/connectors) listed **1,135** connectors when fetched. Smithery, mcp.so, Glama, mcpservers.org and LobeHub were seen via search results; they mostly mirror the same GitHub projects.

**Counts from the official registry** (unique server names matching the keyword, 2026-11-17; rough, since keyword search is noisy): Canvas LMS **12**, calendar-related **28**, Gmail **24**, Google Drive **10**, Outlook **15**, Garmin **23**, Whoop **17**, Spotify **17**, nutrition **17**, Hevy **7**, Moodle **6**, Notion **13**, YNAB **5**, Monarch **5**, Brightspace **3**, Todoist **3**, Google Classroom **1**, Blackboard **0** relevant.

| Category | Official / first-party | Notable community | Maturity notes |
|---|---|---|---|
| **Google Calendar / Gmail / Drive** | Claude's built-in **Google Calendar, Gmail, Drive** connectors (Anthropic-verified; [support article](https://support.anthropic.com/en/articles/11817150-connect-your-tools-to-unlock-a-smarter-more-capable-ai-companion)). **Google's own Workspace remote MCP servers** (per-product endpoints such as `drivemcp.googleapis.com`), announced at Cloud Next '26, in public developer preview ([Workspace blog, May 2026](https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html), [config guide](https://developers.google.com/workspace/guides/configure-mcp-servers?hl=tr)) | Dozens (for example `com.pulsemcp/google-calendar`, `io.github.domdomegg/gmail-mcp`) | Mature and first-party. Sources conflict on whether Claude's Calendar connector can write or is read-only. **Implication: AI already sees Google Calendar, so pushing Petal items to GCal makes them AI-visible for free** |
| Outlook / iCloud | No Microsoft first-party server found | `com.mintmcp/outlook-calendar`, `org.onekash/icloud-calendar-mcp`, `io.github.redpop/apple-calendar-mcp` | Community |
| **Notion** | **Official hosted** `https://mcp.notion.com/mcp`, OAuth, no extra cost. The old open-source local server is deprecated ([GitHub MCP listing](https://github.com/mcp/makenotion/notion-mcp-server), [Stacklok](https://docs.stacklok.com/toolhive/guides-mcp/notion-remote)). Registry: `com.notion/mcp`. In Claude's directory | Several | Mature. One blog reports OAuth re-auth "3+ times/week" (**UNVERIFIED**, anecdotal) |
| **Todoist** | **Official** `net.todoist/mcp`. Hosted `https://ai.todoist.net/mcp` (OAuth) plus local `@doist/todoist-mcp`. Available on all plans ([mcp.directory guide](https://mcp.directory/blog/todoist-mcp-complete-guide-2026), [socket.dev](https://socket.dev/npm/package/@doist/todoist-mcp)) | Several | Mature. The repo moved between `doist/todoist-mcp` and `doist/todoist-ai`, and sources conflict on which is current |
| TickTick | Not confirmed. One Glama table mentions a "TickTick Official MCP" (**UNVERIFIED**) | `alexarevalo9/ticktick-mcp-server`, `io.github.partymola/ticktick-mcp` | Community, using TickTick's Open API |
| Akiflow / Reclaim / Sunsama / Motion | Akiflow: `com.akiflow/akiflow` in the registry (first-party namespace). Reclaim: official remote `mcp.reclaim.ai` per a Glama listing (**UNVERIFIED**). Sunsama: only on its [roadmap](https://roadmap.sunsama.com/integrations/p/mcp-server). Motion: none found | Unofficial Reclaim, Sunsama and Akiflow servers (some take your password or scraped tokens) | AI-scheduling incumbents are adopting MCP fast |
| **Canvas LMS** | **No Instructure-published MCP server found.** Instructure documents REST, GraphQL and LTI ([ibl.ai](https://ibl.ai/developer/connectors/canvas)). **Claude for Education has an official Canvas integration** (LTI, admin-enabled per institution; [Anthropic support](https://support.claude.com/en/articles/11725453-set-up-the-claude-lti-in-canvas-by-instructure), [Anthropic news](https://anthropic.com/news/advancing-claude-for-education)). OpenAI has an Instructure partnership, but a student-facing ChatGPT Canvas connector was not confirmed ([Leon Furze](https://leonfurze.com/2025/07/31/openai-has-come-for-education/)) | 12 in the registry, for example `io.github.vishalsachdev/canvas-mcp`, `canvas-lms-student-mcp`, `canvas-readonly-mcp`, `canvas-parent-mcp`, DMontgomery40's 50+-tool server, `canvas-lms-mcp` on PyPI | Crowded. All community servers use personal API tokens, **which Canvas policy forbids for multi-user apps and many schools disable** |
| Moodle / Brightspace / Blackboard / Google Classroom | None official | Moodle 6, Brightspace 3, Classroom 1 (`AnonymousOnyx22/*-student-mcp` family) | Community, thin |
| Spotify | None official (Spotify is a ChatGPT Apps launch partner, which is a different surface: [Maginative](https://www.maginative.com/chatgpt-turns-into-a-platform-apps-now-live-inside-conversations)) | 17 | Community |
| Fitness / health | None official from Strava, Apple, Google or Hevy | Strava (`ljcl/strava-mcp` remote, `davidmosiah/strava-mcp`), Apple Health (export-file based, for example `neiltron/apple-health-mcp`), Garmin 23, Whoop 17, Hevy 7 (`chrisdoc/hevy-mcp`) | Community. Strava ToS conflicts with AI use (see §1) |
| Recipes / nutrition | `food.myplate/nutrition` (registry namespace suggests official; **UNVERIFIED**). App-owned servers: `cc.halite/recipes`, `ai.saltybytes/recipes` | `ni-c/mealie-mcp`, `mrfentmen/nutritionix-mcp` | Fragmented. No Paprika, Samsung Food or Plan to Eat servers found |
| Finance | Plaid: **sandbox-only** community wrappers. No official Plaid, YNAB or Monarch server found | YNAB 5, Monarch 5, `henfrydls/actual-budget-mcp` | Community, mostly for power users |

**Protocol trends that matter for Petal**
- **MCP Apps** (SEP-1865) is a **Final** official extension, co-developed by Anthropic, OpenAI and MCP-UI. It lets a server return interactive HTML UI (`ui://` resources) that Claude and ChatGPT render inline ([MCP blog](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/), [SEP](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)). A Petal server could render its pastel week view inside the chat, which is a real brand opportunity.
- **WebMCP** (`navigator.modelContext`) lets a **web page itself register tools** for in-browser agents. It is in Chrome Canary behind a flag since Feb 2026, and broad stable support is targeted for 2027 (**UNVERIFIED** date) ([VentureBeat](https://venturebeat.com/infrastructure/google-chrome-ships-webmcp-in-early-preview-turning-every-website-into-a), [eWeek](https://www.eweek.com/news/google-webmcp-chrome-ai-web-standard-preview/)). **This is the one MCP flavour that fits local-first with no backend**, because the tools run in the open tab against IndexedDB. Too early to bet on. Worth a spike later.
- **Client limits:** claude.ai Free can add **one** custom connector, and Pro/Max get more ([Claude docs](https://claude.com/docs/connectors/custom/remote-mcp)). ChatGPT: the help center names **Business, Enterprise and Edu** for full MCP connectors with write actions. Plus is read-only or disputed, and Free has none ([OpenAI help](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt), [Boomi docs](https://help.boomi.com/docs/Atomsphere/Platform/Connect_chatgpt_setup)).
- **Student AI usage is near-universal.** HEPI 2025 found **92%** of UK undergraduates use AI in some form, up from 66% ([HEPI](https://www.hepi.ac.uk/?p=30123)). Demand for "my AI can see my schedule" is plausible. Willingness to configure a custom connector is unproven.

---

## 3. Competitor analysis

Prices are USD unless noted, as reported by the cited sources. Treat them as approximate.

| App | Core features | Integrations | AI / MCP | Price | Student complaints (sourced) |
|---|---|---|---|---|---|
| **Notion** (+ Notion Calendar, Notion AI, Agents) | Blank-canvas docs and databases; huge template ecosystem; Notion Calendar overlays Google/Outlook/iCloud and shows database items | Calendar: Google, Outlook (mobile "coming soon"), iCloud via app-specific password ([2sync](https://2sync.com/blog/how-to-use-notion-calendar)). Database items **don't** sync out to Google, Outlook or iCloud. No native LMS (third-party "Canvas Sync for Notion") | **Official hosted MCP**. Notion Agent for all users. Custom Agents only on Business/Enterprise, credit-metered from May 2026 ([Notion Agents](https://www.notion.com/product/agents)). Agents can call external MCP servers | Free. **Plus free for students with a school email** (1 member). Plus about $10, Business about $20 per member per month annually. Full AI only on Business ([eesel](https://www.eesel.ai/blog/notion-pricing), [lifestack](https://lifestack.ai/blog/notion-pricing)) | Upkeep and template fatigue; slow mobile; offline limits. See §4 |
| **GGC Planners** (girlgottachange / ggcplanners.com — the owner's design inspiration; verified from their product pages in this session) | Web app you sign into (PWA, offline, multi-device). Digital Life Planner: dashboard of today, tasks that carry over, habits with weekly rhythm, wellness 30-day trends, meals + recipes → grocery list + pantry, workouts, 14 collections, travel, goals, notebook, focus timer, print. Digital Student Planner: .ics timetable import, live weighted average + what-if grade simulator, exam readiness/countdowns, assignments with steps, focus-hour log, flashcards per module, free-block finder. Money System: 12-month budget, planned vs actual, debts, sinking funds, investments | Google Calendar live (read-only, multiple accounts); Apple Calendar via published .ics URL; .ics timetable import | None advertised | One-time: Life Planner €38, Student Planner €30, Money System €25 (EUR, Nov 2026 site) | No LMS sync, no AI/MCP, products sold separately (student vs life vs money), no two-way calendar push. Strongest direct comparable to Petal — and already does most of the "student" feature list, so features alone are not a moat |
| **Todoist** | Fast natural-language tasks, projects, filters; "Ramble" voice-to-tasks (Jan 2026) | Google Calendar, many integrations | **Official MCP** (hosted plus local); AI features in Pro | Free; Pro about $5/mo annually after Dec 2025 price rises ([Morgen](https://morgen.so/blog-posts/todoist-pricing), [routine](https://routine.co/blog/posts/todoist-pricing)) | Reviewers say the AI is "less deep than marketing" ([Saner](https://blog.saner.ai/todoist-review/)). No student-specific concepts (classes, grades) |
| **TickTick** | Tasks plus calendar, habits, Pomodoro, Eisenhower matrix | Calendar subscriptions (Premium), Google Calendar | No confirmed official MCP | Premium about $28–36/yr; one Oct 2026 source says $49.99/yr ([ClickUp review](https://clickup.com/learn/topic/task-management/tools/ticktick/), [Activepieces](https://www.activepieces.com/blog/ticktick-pricing-in-2026-for-free-and-premium-plans)) | Free tier caps (9 lists, 99 tasks per list); no grades or LMS |
| **Motion** | AI auto-scheduling of tasks into the calendar | Google, Outlook calendars | AI-first; no MCP found | No free plan; 7-day trial; $19–49+/mo depending on source; **25% student discount** reported ([Morgen](https://www.morgen.so/blog-posts/motion-review), [dailyaifixs](https://dailyaifixs.com/blog/motion-pricing-2026-no-free-plan-ai-credits)) | Price hikes (30% at renewal), a double charge with no refund, scheduling over busy events, AI-only support ([Saner](https://blog.saner.ai/motion-reviews)) |
| **Reclaim.ai** | Habit and task auto-scheduling on Google Calendar | Google/Outlook calendars, Todoist, etc. | Official remote MCP per a Glama listing (**UNVERIFIED**) | Free tier plus paid (**price UNVERIFIED**) | Work-oriented |
| **Akiflow** | Inbox consolidation plus time-blocking | Many (Gmail, Slack, Notion, Todoist…) | First-party namespace `com.akiflow/akiflow` in the registry | About €27.99/mo Pro (source unclear on billing period) ([Asian Efficiency](https://www.asianefficiency.com/task-management/best-daily-planner-apps-ai/)) | Price is far above a student budget |
| **Sunsama** | Guided daily planning ritual | Calendars, Notion, Todoist, Asana… | MCP only on its roadmap | About $20/mo (annual); no free tier ([Asian Efficiency](https://www.asianefficiency.com/task-management/best-daily-planner-apps-ai/)) | Price |
| **MyStudyLife** | Classes (incl. rotation schedules), tasks, exams; cross-platform | Site not reachable during research; integrations **UNVERIFIED** | **UNVERIFIED** | Free plus paid tier (**UNVERIFIED** price) | Crashes, lost data, paywalled features, per a thin blog with no cited sources ([coursesync](https://www.coursesync.biz/post/mystudylife-reviews-is-it-good-free-and-worth-using-in-2026)), **UNVERIFIED** |
| **Shovel** | Study planner with "time cushion" (do you have enough hours?), time-blocking, AI syllabus upload, streaks | **Canvas, Brightspace, Moodle, Google Classroom** auto-import (read-only, about 24h sync); Google/Apple/Outlook calendars; listed in [Brightspace integration hub](https://integrationhub.brightspace.com/details/shovel-study-planner) | AI syllabus import; no MCP found | 7-day trial, then $9.79/mo or about $35–39/yr ([itechguides](https://www.itechguides.com/products/shovel/); DormWay, a competitor) | Setup requires the desktop web app; mobile is a companion; an old (2023) review reports many iOS bugs ([App Store](https://apps.apple.com/to/app/id1467742357?l=en-gb)) |
| **Coursicle** | Course scheduling plus planner | Connects to Canvas, auto-loads assignments ([App Store](https://apps.apple.com/us/app/coursicle/id1187418307)) | — | Freemium (**UNVERIFIED**) | App Store review: kept getting charged, support unreachable |
| **Power Planner** | Homework, schedule, **weighted GPA plus "What If?" grade mode** | Google Calendar; **no Canvas sync** (manual entry) | None | Free and functional; one-time premium about $2.99–4.99 for more than 5 grades per class and multiple semesters ([App Store](https://apps.apple.com/app/id1278178608)) | Manual entry |
| **iStudiez Pro** | Planner, GPA tracker (weighted), many grading scales, Apple Watch | Cloud sync across own devices | None | Free with subscription (listing shows $9.99/yr, $1.99/mo; may be dated) ([App Store](https://apps.apple.com/gb/app/istudiez-pro/id310636441)) | Dated; no LMS |
| **Structured** | Visual timeline day planner, calm UX | Calendar and Reminders sync (Pro) | Some AI day planning (Pro) | Pro $6.99/mo, $29.99/yr, $99.99 lifetime (Sept 2026), lifetime up from $29.99 in 2024 ([Habitbox](https://habitbox.app/blog/structured-app-review)) | Lifetime price hike |
| **Fantastical** | Premium natural-language calendar (Apple/Windows) | All major calendars | No AI or MCP found | Flexibits Premium about $6.99/mo or $56.99/yr ([Morgen](https://morgen.so/blog-posts/fantastical-pricing), [App Pricing Lab](https://apppricinglab.com/iap/apple/718043190)) | Price for students; no student concepts |
| **Paprika** | Best-in-class web recipe import, meal plan, pantry | Browser import | None | One-time per platform (figures conflict: about $5 mobile, $29.99 desktop); one source claims a Nov 2026 pricing change (**UNVERIFIED**) ([RecipeSage](https://recipesage.com/alternatives/paprika/)) | Pay per platform |
| **Samsung Food (Whisk)** | Recipe save, meal plan, smart shopping list | Web import (free tier about 5 imports) | AI features in paid tier (**UNVERIFIED** detail) | Food+ $6.99/mo or $59.99/yr ([RecipeSage](https://recipesage.com/alternatives/samsung-food/), a competitor) | Core features paywalled |
| **Plan to Eat** | URL import, meal plan, shopping list | Any-URL import | None | $5.95/mo or $49–54.99/yr; 14-day trial ([bestmoney](https://www.bestmoney.com/financial-advisor/learn-more/meal-planning-app-saving-money)) | No free plan |
| **Mealime** | Guided meal plans plus lists | — | — | Pro $5.99/mo or $49.99/yr. **One source claims it shut down Oct 21 2026** (**UNVERIFIED**) | — |
| **Strava** | Activity tracking and social | Huge device ecosystem | Its own AI features. **Bans third-party AI use of API data** | Subscription (price not researched) | 2024 API uproar ([Cyclingnews](https://www.cyclingnews.com/news/strava-plan-to-restrict-third-party-apps-has-users-in-an-uproar)) |
| **Hevy** | Strength-workout logging | Apple Health etc.; API for Pro | Community MCPs only | Pro about $2.99/mo, $23.99/yr, $74.99 lifetime ([Recurdash](https://recurdash.com/subscription-pricing/hevy)) | — |

**Read-across**
- **Student-specific apps** (Shovel, MyStudyLife, Power Planner, iStudiez, Coursicle) own LMS import and grade math but have no life layer (meals, fitness, budget) and dated or utilitarian UX. **Notion** owns aesthetics and flexibility but makes the student build everything. **AI schedulers** (Motion, Reclaim, Akiflow, Sunsama) cost $15–35/mo and are built for work. Nobody combines all three at a student price. *That* gap is real.
- LMS auto-import exists (Shovel, Coursicle) but sits behind a paywall and accounts. There is room for "free, no account, paste one link."

---

## 4. Where Notion falls short for students (with sources)

| Gap | Evidence | Petal's position |
|---|---|---|
| **Setup burden and template fatigue** | "Too much upkeep" is the usual failure mode; "spent more time building the perfect system than using it" ([2sync](https://2sync.com/blog/is-notion-a-good-note-taking-app), [Macaron guide](https://macaron.im/blog/notion-study-planner-setup-guide-for-students)). Students abandon detailed setups mid-semester ([Brown Daily Herald](https://www.browndailyherald.com/article/2025/09/planning-kim), [NDSMC Observer](https://www.ndsmcobserver.com/article/2023/10/students-use-google-calendar-paper-planners-to-stay-organized)) | Opinionated schema: classes, assignments, exams and grades exist on day one. **Strong** |
| **Mobile speed** | Capterra student reviewers call mobile "clunky and slow compared to … my laptop" ([Capterra](https://www.capterra.com/p/186596/Notion/reviews/?page=7)); "waaay too slow" on Android ([dev.to](https://dev.to/chiangs/comment/f0f7)) | Local-first IndexedDB means instant reads. But Petal has **no PWA install or phone sync yet**, which wastes the advantage |
| **Offline** | Native offline since Aug 2025, but **per-page opt-in**, about **50 database rows** per view, subpages not included, AI and embeds unavailable, **desktop and mobile apps only, not the browser** ([9to5Mac](https://9to5mac.com/2025/08/20/notion-offline-mode/), [Android Authority](https://www.androidauthority.com/notion-offline-mode-vs-obsidian-3590238), [Thomas Frank](https://thomasjfrank.com/notion-offline-mode-the-ultimate-guide/)) | Fully offline by construction. **Strong**, once a service worker is added |
| **Calendar integration** | Notion database items stay inside Notion Calendar and don't appear in Google, Outlook or iCloud. Outlook mobile "coming soon" ([2sync](https://2sync.com/blog/how-to-use-notion-calendar), [notiontocalendar](https://notiontocalendar.com/blog/notion-calendar-vs-ical-feed)). Students run hybrids: Notion for tasks, Google Calendar for time-blocking ([theaggie](https://theaggie.org/?p=81811), [UX Planet](https://uxplanet.org/why-i-stopped-using-notion-an-honest-ux-review-ebf03e268a01)) | Petal already pushes items to Google with dedupe. **Strong.** Keep it robust |
| **No LMS sync** | Requires third-party tools such as Canvas Sync for Notion ([Canvas sync search summary](https://oituhcl.teamdynamix.com/TDClient/150/Portal/KB/ArticleDet?ID=4631)) | Opportunity (§6 #1) |
| **No grade math** | No native grade or GPA concept; it is possible with formulas but the user must build it (**UNVERIFIED** as a sourced complaint; inferred from the template-building pattern above) | Petal has `src/lib/grades.ts` (current average, needed-on-remaining). **Strong** |
| **AI pricing** | Full Notion AI only on Business ($20/mo); the student Plus plan has at most a trial ([eesel](https://www.eesel.ai/blog/notion-pricing), [truescho](https://truescho.com/en/blog/notion-ai-students-2026)) | Petal can rely on the user's own Claude or ChatGPT via MCP (later) or a BYO key. Moderate |
| **Where Notion wins and Petal won't** | Free Plus for students; notes, wikis and collaboration; official MCP; brand | Don't compete on notes or docs. Import from Notion (CSV) to reduce switching cost |

---

## 5. What an MCP server for a local-first browser app would look like

| Option | How | Reaches | Effort | Verdict |
|---|---|---|---|---|
| **A. Export plus local stdio server** | User exports backup JSON; a tiny `npx petal-mcp --file backup.json` serves read-only tools | Claude Desktop, Cursor, Claude Code (desktop only) | S | Dev-toy. Stale data, writes impossible, students won't run `npx` |
| **B. Local bridge to the open tab** | Local stdio server ↔ WebSocket on localhost ↔ the Petal tab (the tab owns IndexedDB) | Desktop clients only, while the tab is open | M | Fragile (browser localhost and mixed-content rules, tab must be open). Niche |
| **C. Hosted sync layer plus remote MCP** | Add accounts and sync (server copy of the store; optionally end-to-end encrypted, though E2E makes server-side MCP impossible unless the server can decrypt). Expose a Streamable HTTP MCP endpoint with OAuth 2.1 | claude.ai web and mobile, Claude Desktop, ChatGPT (plan-limited), Cursor; MCP Apps UI | L for sync, then M for MCP | **The only real option.** Justify the sync backend on its own merits (phone and laptop sync, Google refresh tokens, LMS feed polling, webhooks); MCP rides on it |
| **D. WebMCP in-page tools** | `navigator.modelContext.registerTool(...)` inside Petal; the browser's agent calls tools against IndexedDB | In-browser agents (Chrome/Gemini, Claude in Chrome, **UNVERIFIED** support) | S–M | Perfect architectural fit, **not shippable until stable (2027?)**. Spike behind a flag |

**Free alternative that already works today:** Petal already pushes items to Google Calendar. Claude's Google Calendar connector and Google's Workspace MCP can read them, so "ask Claude what's due this week" works now if items are in GCal. Make that push reliable and descriptive (put class, type and weight in the event description) before building anything MCP.

---

## 6. Recommendations: top 5 differentiators, ranked by (student value × feasibility)

| # | Differentiator | Student value | Feasibility on our stack | Effort | Architecture | MCP / API / neither |
|---|---|---|---|---|---|---|
| 1 | **Paste-your-LMS-link semester import (live)** | Very high | High | **S–M** | Stateless CORS proxy | API (ICS) |
| 2 | **Syllabus → grade weights → "what do I need" (auto grade plan)** | High | Medium–high | **M** | LLM call: BYO key in browser or a tiny backend | API (LLM) |
| 3 | **Phone-first, fully offline PWA (then optional sync)** | High | High (PWA) / Medium (sync) | **S** (PWA) + **L** (sync) | Service worker; sync backend later | Neither |
| 4 | **Cross-life auto-planner: study blocks around classes, gym, meals** | High | Medium | **M** | Local, deterministic; no backend | Neither |
| 5 | **Petal MCP server plus MCP Apps week view** | Medium (power users), good retention | Low until #3 sync exists | **M** on top of sync | Remote MCP on the sync backend | **MCP** |

### 1. Paste-your-LMS-link semester import (live subscription)
- **What:** Onboarding step: "Paste your Canvas / Brightspace / Moodle calendar feed URL" (with per-LMS screenshots showing where to find it). Petal fetches it through a proxy, classifies items (assignment, exam, class) with the existing `src/lib/ics.ts` heuristics, groups them by course into Classes (auto-creating class pages with colours), and **refreshes on app open or hourly**. Refreshes **merge** and keep the student's own edits (steps, notes, estimates). Show a diff ("2 new, 1 moved: Essay 3 now due Fri").
- **Why competitors don't do it well:** Notion needs a paid third-party sync. Power Planner and iStudiez are manual. Shovel does it but behind a $35+/yr paywall and desktop setup. Google Calendar subscription refreshes **up to every 24h** and loses the assignment semantics (no countdowns, no grades) ([UH KB](https://oituhcl.teamdynamix.com/TDClient/150/Portal/KB/ArticleDet?ID=4631)).
- **Caveats to design for:** the feed excludes Canvas To Do items and undated items, and some schools disable feeds. Fall back to `.ics` file import (exists) and #2. Course names in feeds are messy, so provide a rename and merge UI.
- **Architecture:** a stateless proxy (Cloudflare Worker or Vercel edge) that takes a URL, allow-lists LMS-looking hosts, and returns `text/calendar` with CORS. **Privacy note:** feed URLs are bearer secrets, so don't log them. The proxy also unlocks recipe-URL import (schema.org JSON-LD).
- **Not recommended now:** the Canvas REST API for grades. It needs per-institution developer keys, and personal tokens violate policy.

### 2. Syllabus → semester plan with grade weights wired to the calculator
- **What:** Paste text or upload a syllabus PDF. Extract assignments, exams, dates **and grading weights** into a class, pre-filling the existing grade calculator. Then "you need 74% on the final for a B+" works from day one. Combined with #1, the feed gives dates and the syllabus gives weights.
- **Why competitors don't do it well:** syllabus-to-calendar is now common (Shovel, DormWay, Coursicle per [Coursicle blog](https://www.coursicle.com/blog/best-syllabus-to-calendar-apps/)), so it is **not unique by itself**. The edge is feeding **weights into live grade math** in the same place as countdowns. Power Planner and iStudiez have grade math but no import. Notion has neither natively.
- **Architecture:** an LLM extraction call. Option (a): BYO Anthropic or OpenAI key, called directly from the browser (Anthropic's API supports browser calls with an explicit opt-in header, **UNVERIFIED for current policy**; confirm before building). Option (b): a small backend endpoint with rate limits, which costs money per user. Always show an editable review table before saving.

### 3. Phone-first, fully offline PWA (then optional sync)
- **What:** Installable PWA (manifest plus service worker caching the app shell), mobile layouts for Today, Tasks and quick-add, and local notifications for countdowns where supported. Later, **optional** account sync so phone and laptop share data. That sync is the backend that also gives Google refresh tokens (no more hourly "Reconnect"), server-side LMS feed polling, and webhooks.
- **Why competitors don't do it well:** Notion mobile is slow, offline is opt-in with row caps and excludes the browser. Shovel's mobile app is a companion. Petal is local-first, so it is fast and offline by default. Today that advantage is wasted because data is stuck in one browser.
- **Effort:** PWA **S**. Sync **L**: conflict handling, auth, hosting, and a privacy policy. Consider an off-the-shelf local-first sync engine before rolling your own (not researched here).

### 4. Cross-life auto-planner ("plan my week")
- **What:** Given deadlines (with effort estimates, defaulting by type), class times, planned workouts, meal-prep slots and sleep goals, propose study blocks in free time ahead of each deadline. Show a "time cushion" warning when the hours don't fit (borrowing Shovel's best idea), and push the accepted blocks to Google Calendar. One button: "Plan my week", then review, then accept.
- **Why competitors don't do it well:** Motion, Reclaim and Akiflow do auto-scheduling for **$15–35/mo** and aren't student-shaped (no exams, classes or grade stakes). Student apps don't schedule. **No one schedules across study, gym and meals**, and Petal is the only one holding all three.
- **Architecture:** deterministic local algorithm (greedy earliest-deadline-first into free slots). **No LLM or backend needed.** This is also the best future MCP tool (`plan_study_blocks`).

### 5. Petal MCP server (after sync), with an MCP Apps week view
- **What:** a remote MCP endpoint (Streamable HTTP plus OAuth) over the synced store, listed in Claude's directory and submitted as a ChatGPT app. It returns an **MCP Apps** inline pastel week or agenda widget, which turns brand into a feature inside the chat.
- **Why it is #5, not #1:** incumbents already have official MCP servers. It needs #3's backend. Clients cap custom connectors (Claude Free: 1; ChatGPT writes mainly on Business/Edu). Its value is to existing users. What makes it worth doing at all is the **cross-domain schema** (assignments, grades, habits, meals, budget) no other connector has.
- **Guardrails:** writes need confirmation. Never forward Strava-sourced data (ToS). Treat imported LMS and Gmail text as untrusted (prompt injection; Google's own MCP guide warns about this, see [config guide](https://developers.google.com/workspace/guides/configure-mcp-servers?hl=tr)).

**Honourable mentions:** recipe-URL import via the #1 proxy (S); Notion CSV import to steal switchers (S); Google Classroom via the existing Google OAuth (M; needs verification).
**Explicitly deprioritise:** Plaid or banking (backend, cost, compliance), Gmail deadline extraction (restricted scope, CASA yearly), Apple Health and Google Fit (no web API; Fit shut down in 2026), Strava (AI-use ban), Spotify (low value), Canvas REST grades (per-school keys).

---

## 7. Proposed MCP tool surface (if/when #5 is built)

Keep it small: about 12 tools, verbs scoped to the student's own data. All write tools return the changed item and support a `dry_run` flag so the assistant can preview.

| Tool | R/W | One-line description |
|---|---|---|
| `list_upcoming_deadlines` | R | Assignments and exams due in the next N days, with class, weight, steps done/total and days-left countdown |
| `get_agenda` | R | Merged timeline (classes, events, items, workouts, Google events) for a date range. Mirrors `useAgenda` |
| `get_class` | R | One class: schedule, links, note titles, upcoming items, grade summary |
| `get_grade_status` | R | Current weighted average and the score needed on remaining work to hit a target (wraps `grades.ts`) |
| `add_assignment` | W | Create an assignment, exam or task (type, class, due date, weight, steps) |
| `update_item` | W | Reschedule, complete, add a step, or change the weight of an item |
| `add_event` | W | Create a calendar event (supports the recurrence rules in `dates.ts`) |
| `plan_study_blocks` | W* | Propose study blocks for a date range around existing commitments; `dry_run` returns a proposal and `commit` writes and pushes to Google |
| `log_checkin` | W | Log mood, energy, sleep or water and mark habits done for a day |
| `log_workout` | W | Plan or log a workout (sets, reps, weight) |
| `plan_meals` | W | Put recipes on days and send their ingredients to the grocery list |
| `get_budget_summary` | R | Planned vs actual by category and money left this month |
| `add_expense` | W | Record an expense or income in a category |

Resources: `petal://week/{isoWeek}` (agenda snapshot), `petal://class/{id}`. Prompts: `weekly_review`, `exam_prep_plan`. UI (MCP Apps): `ui://petal/week` inline week view.

---

## 8. Biggest surprises

1. **The cheapest "AI connectivity" is already shipped:** Petal's Google Calendar push plus Claude's built-in GCal connector or Google's own Workspace MCP servers means AI assistants can already read Petal items.
2. **Canvas is crowded on the AI side but blocked on the API side.** There are 12+ community Canvas MCP servers and Claude for Education has an official Canvas LTI, yet Canvas policy forbids multi-user apps from using pasted personal tokens and many schools disable them. The humble ICS feed is the only zero-permission path.
3. **Strava bans third-party AI use of its API data**, so a "connect everything to your AI" pitch would breach the terms of the most popular fitness API.
4. **Google Fit's REST API dies in 2026 and the Fitbit Web API died on Nov 2 2026**, so a web app has no Android-health path at all.
5. **WebMCP** (tools registered by the web page itself) is the only MCP flavour that suits a no-backend app. It is still Canary-only.
6. Notion gives Plus **free to students** and has an official MCP server. Competing with Notion on "AI connectivity" is competing where Notion is strongest. Competing on "zero setup, fast phone, offline, LMS plus grades plus life" is competing where students say it is weakest.
