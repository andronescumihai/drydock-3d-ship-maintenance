<div align="center">

# 🚢 DryDock — 3D Digital Twin for Ship Maintenance
**Developed by Andronescu Mihai-Alexandru**

[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5_strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-React_Three_Fiber-000000?style=for-the-badge&logo=three.js&logoColor=white)](https://r3f.docs.pmnd.rs/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Vitest](https://img.shields.io/badge/Tests-72_passing-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/)
[![Status](https://img.shields.io/badge/Status-Live-success?style=for-the-badge)]()

*A premium, dark-industrial 3D digital twin of a modeled cargo vessel: rotate it, pull its decks apart, click any pump, pipe or switchboard, mark it as failed, and a real graph engine tells you what else goes down with it, what has to come apart to reach it, how long the repair takes and how urgent it is.*

[🔗 Live Demo](https://drydock-3d-ship-maintenance.vercel.app) • [🏗️ Architecture](#️-architecture) • [⚙️ How It Works](#️-how-it-works) • [🖥️ Interface](#️-interface) • [🚀 Getting Started](#-getting-started) • [📬 Contact](#-contact)

</div>

## 📌 Project Overview

**DryDock** answers the question a ship's engineer asks the moment something breaks: *"if this part fails, what happens next, and how do I get to it?"*

The app renders a 90 m coastal cargo vessel in 3D, anchored off Rio de Janeiro, with its hull, decks, compartments and 47 machinery components modeled in detail. Select a component in the 3D view or in the component tree and a glass analysis panel opens with five answers, all computed live: the **cascade** of systems and components that lose power, fuel, cooling or drive because of it; the **neighbours in physical danger** (flooding near electrical gear, fuel spray near hot surfaces); the **access path** from the gangway, naming every door, hatch, floor plate and spool piece that has to come off; a **repair plan** with material, crew and time; and an **urgency score** where every point is explained.

Press **Simulate failure** and the cascade plays out on the ship wave by wave, with lost components lighting up amber through the hull plating and the access route drawn through the decks.

![Profile, plan and body plan of the modeled vessel](docs/vessel-plan.svg)

> 🔗 **Live app:** [drydock-3d-ship-maintenance.vercel.app](https://drydock-3d-ship-maintenance.vercel.app)

## ⚓ Modeled Sample Vessel (read this first)

The ship is a **modeled sample vessel**, the *MV Sample Coaster*. Its hull form, compartment layout, component list, materials, repair times and dependency network are a documented simulation built for this project. They are **not** data from any real ship, they were not validated by a naval architect or a chief engineer, and they must not be used for real engineering decisions. Every component carries a `note` field explaining what was modeled and why, and the disclaimer is shown permanently in the interface.

What **is** real is the intelligence: the impact cascade, the access path and the urgency score are computed by an actual graph engine running over this model, not scripted or pre-baked. Change the data and the answers change with it.

The Rio de Janeiro waterfront, the boats, the aircraft and the sea life are scenery generated in code: the landmarks and their heights are real, the shapes and distances are a stylised reconstruction.

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Typed JSON model (lib/data)                               │
│  vessel · systems · components · access                    │
└─────────────────────────────┬──────────────────────────────┘
                              │  Zod validation + referential checks
                              ▼
┌────────────────────────────────────────────────────────────┐
│  VesselModel (lib/engine/model.ts)                         │
│  supply graph (feeds → derived dependsOn) + access graph   │
└──────┬───────────────┬───────────────┬───────────────┬─────┘
       │               │               │               │
       ▼               ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ impact.ts   │ │ access.ts   │ │ proximity.ts│ │ repair.ts   │
│ BFS cascade │ │ Dijkstra +  │ │ 6 m hazard  │ │ phased job  │
│ O(V + E)    │ │ binary heap │ │ scan        │ │ plan        │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
       └───────────────┴───────┬───────┴───────────────┘
                               ▼
                  ┌─────────────────────────┐
                  │ urgency.ts              │
                  │ 6 explained factors     │
                  │ → score 0–100 + band    │
                  └────────────┬────────────┘
                               │  analysis result
                               ▼
┌────────────────────────────────────────────────────────────┐
│  Zustand store (lib/state/useVesselStore.ts)               │
└──────────────┬───────────────────────────────┬─────────────┘
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│ 3D scene (R3F / Three.js)   │ │ Glass HUD analysis panel    │
│ markers · x-ray · cascade   │ │ Overview · Impact · Access  │
│ access path · day / night   │ │ Repair · Urgency            │
└─────────────────────────────┘ └─────────────────────────────┘

   lib/engine and lib/geometry never import React or Three.js:
   the engine is tested in isolation, the scene and the HUD are only views of it
```

## 🗂️ Data Model

Everything lives in typed JSON inside the repo: no database, no external API, no keys.

| File | What it contains |
|:---|:---|
| **`vessel.json`** | Hull parameters (90 m length, 14 m beam, 6.5 m depth, 3.85 m draught), 4 decks, 15 compartments, the on-screen disclaimer |
| **`systems.json`** | 10 systems: Propulsion, Electrical Power, Cooling, Fuel Oil, Ballast, Bilge & Drainage, Deck & Cargo Handling, Steering, Auxiliary Services, Navigation & Safety |
| **`components.json`** | 47 components: system, compartment, 3D position and geometry, material, criticality (1–5), repair and replacement minutes, crew, hazards, manual standby, access node, and 36 supply edges typed by resource (electrical, fuel, cooling, sea water, lubrication, hydraulic, mechanical, control) |
| **`access.json`** | A separate physical graph of 92 nodes and 97 edges: gangway, walkways, doors, hatches, ladders, floor plates, spool pieces and work faces, each with a time cost |

```jsonc
{
  "id": "PMP-SW-01",
  "name": "Sea Water Cooling Pump No.1 (duty)",
  "systemId": "SYS-COOL",
  "compartmentId": "CMP-ER-LOWER",
  "position": { "x": -25, "y": 1.0, "z": 2.8 },
  "material": "bronze-b62",
  "criticality": 4,
  "feeds": [{ "to": "HX-CENTRAL-01", "resource": "seawater" }],
  "backedUpBy": ["PMP-SW-02"],
  "accessNodeId": "AN-ER-PUMP-BAY",
  "hazards": ["flooding"],
  "repair": { "meanRepairMinutes": 180, "replaceMinutes": 420, "crewRequired": 2 },
  "note": "Modeled: duty centrifugal SW pump, bronze casing…"
}
```

The model is validated with **Zod** when it loads and then cross-checked: unknown ids, dangling edges, self-references and components placed outside their compartment fail loudly at startup. `dependsOn` is never written by hand, it is derived by inverting `feeds`, so the two directions can never contradict each other. A test also checks every component against the hull shape itself, so nothing floats outside the ship.

## ⚙️ How It Works

### 1. Select a component
Click a marker in the 3D view or pick it from the component tree. The camera frames the part, even inside the closed hull, where it is drawn through the plating as an x-ray outline.

### 2. Impact analysis: what goes down with it
The supply graph is directed and every edge carries a resource kind. The rule that makes the result defensible: a component needs **all** the resource kinds it consumes, but within one kind **any** live supplier is enough. Losing cooling stops the main engine even with fuel intact, while losing one of two parallel generators does not black out the switchboard. Propagation is a breadth-first traversal with a live-supplier counter per `(component, resource)` pair, the shape of Kahn's algorithm, in `O(V + E)`. Feedback loops need no special case, and every lost component records its depth and its cause, which drives the wave-by-wave animation. Components that kept running thanks to a redundant supplier are reported as *held by redundancy*.

### 3. Access path: what has to come apart
A second, independent graph models the physical route. Walking costs distance at 0.8 m/s, and every node costs its own minutes: undogging a door, lifting floor plates, removing a spool piece. The route is a **Dijkstra** search with a binary heap from the gangway. Dijkstra and not BFS because the weights are wildly uneven: a four-minute walk round the deck can beat a shortcut through a tank that needs hours of gas-freeing. Routes that pass through other equipment name it, and everything removed feeds the reassembly time.

### 4. Repair plan and collateral risk
The job is laid out end to end: access, isolation and permits, the repair itself, reassembly, testing. The material decides what is allowed on board (cast iron is not welded at sea, steel is, under a hot-work permit). A proximity scan within 6 m flags physical danger to the neighbours: sea water over electrical gear, fuel spray onto hot surfaces, arc-flash and burst radii.

### 5. Urgency score, explained
No black-box number: the score is a plain sum of six factors, each with a maximum and a sentence explaining its value.

| Factor | Max | How |
|:---|---:|:---|
| Component criticality | 25 | criticality / 5 × 25 |
| Cascade | 25 | 25 × (1 − e^(−Σ criticality of lost components / 18)) |
| Vital functions | 20 | propulsion, steering, blackout, bilge / fire pumping |
| Time to restore | 12 | hours from gangway to handover, capped at 24 |
| Logistics | 10 | no spare, hot-work permit, system shutdown |
| Hazards & collateral | 8 | hazards at the work face and neighbours at high risk |
| Standby credit | −15 | a manual standby the crew can start |

**Critical** ≥ 75 · **High** ≥ 50 · **Moderate** ≥ 25 · **Low** below. The weights are a documented modeling choice for this sample vessel, not an industry standard.

## 🖥️ Interface

| Section | Contents |
|:---|:---|
| **Landing page** | Animated wordmark and tagline, entry into the twin |
| **3D view** | Orbit, zoom and pan around the ship; clickable component markers; x-ray view of hidden parts; access path drawn through the decks |
| **Component tree** | Every component grouped by system; selecting one selects it in 3D, and a click in 3D unfolds its branch |
| **Analysis panel** | Glass side panel with five tabs: Overview, Impact, Access, Repair, Urgency |
| **Simulate failure** | Fires the failure and plays the cascade wave by wave on the ship |
| **View controls** | Deck separation (exploded view), hull section from starboard or port, render quality (High / Balanced / Light) |
| **Day / night switch** | Phone-style toggle that carries the sun down through the sunset and blue hour into a moonlit night, with the ship's floodlights, lit cabins and city lights |
| **Honesty tag** | A permanent "modeled sample vessel" label in the corner of the screen |

The 3D world is built entirely in code, with no external models or photos: a procedural lofted hull with physically based materials and baked textures, a Gerstner-wave sea, a per-pixel atmospheric sky, a stylised Rio de Janeiro waterfront (Pão de Açúcar, Corcovado, Copacabana) with about 3,000 buildings, plus boats, kayakers, aircraft, dolphins and a humpback whale as scenery.

Interface motion uses nine components from [React Bits](https://reactbits.dev) by David Haz (TechText, WarpText, DitherVeil, GradualBlur, PaperCrumple, BranchedMenu, SloshGauge, JellyRadio, SlingButton), adapted to the HUD palette and credited in `components/reactbits/`.

## 🛠️ Technical Stack

| Layer | Technology |
|:---|:---|
| **Framework** | Next.js 15 (App Router) · React 19 · TypeScript (strict) |
| **3D** | Three.js · React Three Fiber · drei · postprocessing |
| **Graph engine** | Pure TypeScript: BFS cascade, Dijkstra with binary heap, scoring |
| **Data & validation** | Typed JSON · Zod |
| **State** | Zustand |
| **Styling** | Tailwind CSS 4 · dark industrial HUD with glassmorphism |
| **Animations** | React Bits components · `motion` · `ogl` |
| **Testing** | Vitest (72 tests: engine, data model, hull geometry, day/night) |
| **Hosting** | Vercel (free/Hobby tier), zero environment variables required |

## 📂 Repository Structure

```
DryDock/
│
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # landing page
│   ├── twin/page.tsx               # the 3D digital twin
│   └── globals.css                 # HUD theme, glass tokens
│
├── components/
│   ├── scene/                      # R3F scene: hull, decks, markers, camera, sea, sky, lights
│   │   ├── parts/                  # procedural machinery and deck gear
│   │   ├── pbr/                    # physically based surface materials
│   │   ├── marine/                 # dolphins, whale, fish, gulls
│   │   └── world/                  # Rio waterfront, boats, aircraft
│   ├── hud/                        # glass HUD: controls, component tree, day/night switch
│   │   └── analysis/               # Overview, Impact, Access, Repair, Urgency tabs
│   ├── reactbits/                  # vendored React Bits components (credited)
│   └── ui/
│
├── lib/
│   ├── engine/                     # the graph engine: impact, access, repair, proximity, urgency
│   ├── data/                       # JSON model + Zod schemas + validating loader
│   ├── geometry/                   # parametric hull maths
│   └── state/                      # Zustand store
│
├── tests/                          # Vitest suites
├── scripts/                        # texture baker, hull plan preview, HUD art
├── public/textures/                # procedurally baked textures (no external assets)
├── docs/vessel-plan.svg            # generated profile, plan and body plan
├── next.config.ts                  # security headers + CSP
└── package.json
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18.18+ (20 or newer recommended)

### 1. Clone

```bash
git clone https://github.com/andronescumihai/drydock-3d-ship-maintenance.git
cd drydock-3d-ship-maintenance
```

### 2. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). There is no `.env` file to configure and no API key required: the whole model ships with the repo.

### 3. Tests and production build

```bash
npm run typecheck
npm test
npm run build
npm run start
```

## 🌍 Deployment

Deployed on [Vercel](https://vercel.com/) (Hobby/free tier). Framework is auto-detected as Next.js, build and output settings are all defaults, and **no environment variables are required**. Every push to `main` triggers an automatic redeploy.

## 🔒 Security & Privacy

- **No secrets in the codebase.** No API keys or credentials anywhere: none are needed.
- **No backend, no tracking.** No database, no accounts, no cookies, no forms, no third-party scripts or requests. Fonts are self-hosted, so the app makes no external call at runtime.
- **Strict security headers.** Content-Security-Policy limited to the site's own origin, no framing (`frame-ancestors 'none'`), HSTS, `X-Content-Type-Options`, strict `Referrer-Policy`, cross-origin isolation headers and a `Permissions-Policy` that disables camera, microphone, geolocation and payment, all set in `next.config.ts`.
- **Validated data.** The model is checked with Zod on load, so malformed data fails loudly instead of rendering something wrong.
- **Dependencies.** `npm audit` reports no known vulnerabilities. See [SECURITY.md](SECURITY.md).

## ⚠️ Known Limitations

- **Modeled, not real.** The vessel, its components, materials, repair times and dependencies are a documented simulation, not data from a real ship and not validated by a marine engineer.
- **Machinery-focused dataset.** The engine room systems are modeled in depth; cargo, deck and accommodation systems are represented mostly by their compartments.
- **Estimated times.** Repair and access times are plausible orders of magnitude, not figures from a planned maintenance system.
- **No buffer tanks.** Fuel reaches the engines straight from the separator, so a separator failure blacks the ship out at once; real plants are more forgiving.
- **The access graph models obstacles,** not crew availability, tools, permit procedures or sea state.
- **No naval architecture.** No hydrostatics, stability or structural analysis: the hull is a shape, not a calculation.
- **Scenery is stylised.** The sea is a visual model (the ship does not respond to waves), the day/night cycle is a time-lapse rather than an ephemeris, and Rio is a procedural reconstruction.

## 🗺️ Roadmap

Core features (3D twin, component selection, impact cascade, access path, repair plan, urgency score, failure simulation, day/night cycle) are complete. Possible next steps: multiple simultaneous failures, a maintenance history per component, loading other vessel datasets from the UI, and export of the repair plan as a work order.

## 📬 Contact

<div align="center">

**Andronescu Mihai-Alexandru**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/mihai-alexandru-andronescu-58792b33b/)
[![Email](https://img.shields.io/badge/Email-Contact-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:andronescumihai.alex13@gmail.com)

</div>

<div align="center">
<sub>Modeled vessel, real graph engine: break a part, see what follows.</sub>
</div>
