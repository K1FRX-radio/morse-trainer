# UI/UX audit and IA proposal (Issue #78)

Part of #77.

## Scope reviewed

Reviewed all major user-facing surfaces and states in:

- [src/App.tsx](/home/ofrias/personal/k1frx-morse-trainer/src/App.tsx)
- [src/ui/app-root.tsx](/home/ofrias/personal/k1frx-morse-trainer/src/ui/app-root.tsx)
- [src/ui/screens/LearnScreen.tsx](/home/ofrias/personal/k1frx-morse-trainer/src/ui/screens/LearnScreen.tsx)
- [src/ui/screens/PracticeScreen.tsx](/home/ofrias/personal/k1frx-morse-trainer/src/ui/screens/PracticeScreen.tsx)
- [src/ui/screens/CopyPractice.tsx](/home/ofrias/personal/k1frx-morse-trainer/src/ui/screens/CopyPractice.tsx)
- [src/ui/screens/SendPractice.tsx](/home/ofrias/personal/k1frx-morse-trainer/src/ui/screens/SendPractice.tsx)
- [src/ui/screens/ImportedTextPractice.tsx](/home/ofrias/personal/k1frx-morse-trainer/src/ui/screens/ImportedTextPractice.tsx)
- [src/ui/screens/StatsHistoryScreen.tsx](/home/ofrias/personal/k1frx-morse-trainer/src/ui/screens/StatsHistoryScreen.tsx)
- [src/ui/screens/SettingsScreen.tsx](/home/ofrias/personal/k1frx-morse-trainer/src/ui/screens/SettingsScreen.tsx)
- [src/global.css](/home/ofrias/personal/k1frx-morse-trainer/src/global.css)

This includes first-run/loading/error startup states, Learn flow, Practice mode
switching, History, Settings, data/storage notices, PWA update/offline notices,
and mobile vs desktop navigation behavior.

## 1) Current-flow map

### A. App bootstrap + shell

1. App starts in loading state ("Opening training data...").
2. If storage open fails, user lands in an error state with retry.
3. If a tab/storage lifecycle event blocks startup, user gets blocker guidance.
4. If another tab forces a stale connection, user must reload.
5. Once ready, user sees:
   - app title/tagline;
   - optional storage lifecycle notice;
   - optional PWA update/offline notice;
   - main route + sticky bottom nav.

### B. Learn (first-run to session summary)

1. **Onboarding dashboard**:
   - progress bar (discovered characters);
   - character tile map with detail flyout;
   - primary actions: "Start learning" / "Start long copy" (when unlocked >= 2).
2. **Lesson loop**:
   - introduce character -> copy cards -> feedback -> continue/replay.
3. **Transitions/notifications**:
   - interstitial screens requiring Continue.
4. **Continuous copy mode**:
   - timed textarea, countdown, pause/resume/finish, end session.
5. **Continuous copy result**:
   - aligned accuracy summary.
6. **Session summary**:
   - card + accuracy summary, advancement eligibility messaging, recommended next
     action buttons, possible advancement accept.

### C. Practice

Top-level Practice tab has nested tab switch:

- Copy
- Send
- Text RX

Each sub-mode has independent controls, save/retry states, and a distinct task model.

### D. History

Single screen with:

- summary cards;
- trend list;
- character metrics;
- speed-band proficiency;
- confusion pairs;
- milestones.

### E. Settings

Single long page with mixed concerns:

- install guidance;
- training/audio preferences;
- audio output device permissions;
- persistence request controls;
- backup export/import;
- destructive reset.

## 2) Prioritized UX problems

### P0 (high impact)

1. **Focused-copy mode competes with global navigation chrome**  
   During active copy, controls compete with persistent header/nav and broad
   option density. Focused, high-cognitive tasks should suppress nonessential UI.

2. **First-minute clarity is weak for new users**  
   App explains many mechanics, but the immediate "what should I do now?" path
   is diluted by many equal-weight elements.

3. **Settings mixes "task tuning" and "system/data admin"**  
   Core speed/tone controls and high-risk data-reset/import actions share one
   stream without stronger hierarchy boundaries.

### P1

4. **Practice mode switching is hidden one layer down**  
   User has top-level nav and inner mode tabs, producing two navigation systems
   with similar visual weight.

5. **History has high information density with low progressive disclosure**  
   It is comprehensive but can overwhelm users who only need "am I improving?"

6. **Storage/PWA lifecycle messages appear in header context**  
   Important system notices share the same visual region as brand/tagline; this
   blurs system urgency vs routine navigation.

### P2

7. **Implementation-centric wording leaks into UX**  
   Terms like "portable data", "persistent storage", and "band-weighted" are
   valid but better framed behind user-goal language and optional detail.

8. **Retry/error handling is consistent but repetitive**  
   Many screens expose local save states similarly; this is reliable but noisy.

## 3) Proposed top-level IA

Recommended top-level structure:

1. **Train** (guided Learn path + long-copy readiness loop)
2. **Practice** (self-directed Copy / Send / Text RX)
3. **Progress** (History + milestones + "what to work on next")
4. **Settings** (preferences + system/data)

Rationale:

- Keeps learner intent first ("train", "practice", "progress").
- Preserves current behavior contracts while clarifying destination purpose.
- Reduces concept switching between route labels and user goals.

## 4) Navigation model proposal

### Global model

- Keep bottom navigation on mobile and standard nav on desktop.
- Promote one clear primary destination per screen (single dominant CTA).
- Move system notices into a dedicated top-level "System status" stack with
  severity styling and optional "details" disclosure.

### Focused training model

When user is actively copying (Learn card, continuous copy, imported text play):

- collapse nonessential metadata;
- reduce simultaneous actions (keep only task-critical controls);
- keep "End session" available but visually secondary;
- keep navigation protected/blocked consistently.

### Practice navigation

- Keep Practice as one destination.
- Convert inner mode tabs into segmented control with explicit descriptions:
  "Copy (listen/type)", "Send (key/decode)", "Text RX (long audio copy)".

## 5) Principles for active-training vs setup/config states

1. **Task-first while copying**: show prompt, input, and only relevant controls.
2. **Configuration second**: defer advanced options until pause/end/summary.
3. **One mode, one objective**: avoid simultaneous competing objectives.
4. **State legibility**: playback/saving/error states must be immediate and short.
5. **Recoverability**: retries and interruptions should always preserve user trust.
6. **Safety for destructive actions**: isolate import/replace/reset from routine tuning.

## 6) Low-fidelity wireframes (major flows)

### Mobile: first visit / onboarding

```text
┌───────────────────────────────────┐
│ K1FRX Morse Trainer               │
│ Learn CW by ear                   │
├───────────────────────────────────┤
│ Train                             │
│ [ 3 of 40 discovered ]            │
│ [progress bar................]    │
│                                   │
│ Primary: [ Start training ]       │
│ Secondary: [ Practice long copy ] │
│                                   │
│ Character map (collapsed preview) │
└───────────────────────────────────┘
```

### Mobile: active copy focus mode

```text
┌───────────────────────────────────┐
│ Train · Card 6/18                │
│ Prompt: Copy the group you hear   │
│ [input........................]   │
│                                   │
│ [ Replay ] [ Continue ]           │
│                                   │
│ status: Listening / Ready         │
│ feedback row                      │
├───────────────────────────────────┤
│ End session (quiet secondary)     │
└───────────────────────────────────┘
```

### Mobile: continuous copy

```text
┌───────────────────────────────────┐
│ Continuous copy                   │
│ 02:14 remaining                   │
│ [progress bar................]    │
│                                   │
│ [textarea capture area]           │
│                                   │
│ [ Pause ] [ Finish ]              │
│ End session (secondary)           │
└───────────────────────────────────┘
```

### Mobile: settings (grouped by intent)

```text
┌───────────────────────────────────┐
│ Settings                          │
│                                   │
│ Training defaults                 │
│ - speed/tone/noise/pacing         │
│                                   │
│ Audio routing                     │
│ - output device                   │
│                                   │
│ App data & safety                 │
│ - backup export/import            │
│ - reset (separate danger zone)    │
│                                   │
│ Install app                       │
└───────────────────────────────────┘
```

### Desktop: shell

```text
┌─────────────────────────────────────────────────────────────┐
│ Header: title + concise status chips (offline/update/tab)  │
├─────────────────────────────────────────────────────────────┤
│ Main content (Train/Practice/Progress/Settings)            │
│ with larger spacing + sectional side anchors where useful  │
├─────────────────────────────────────────────────────────────┤
│ Nav bar (can remain static on desktop)                     │
└─────────────────────────────────────────────────────────────┘
```

## 7) Decisions needing owner/product review

1. **Top-level naming change**: keep Learn/History labels or adopt
   Train/Progress naming.
2. **Focused mode strictness**: during active copy, should global nav be hidden,
   disabled, or just visually de-emphasized?
3. **Long-copy placement**: keep as Learn action, or also expose a dedicated
   quick-launch in Practice.
4. **History simplification strategy**: default to compact summary first, with
   progressive disclosure for advanced analytics.
5. **Settings restructuring depth**: one page with stronger grouping vs split
   into subroutes (for example "Training", "Audio", "Data").
6. **System notice model**: inline header notices vs dedicated dismissible
   status center.

## Recommended follow-on implementation slices

For #79+#80+#81+#82+#83, prefer this order inside the sprint:

1. Shell + information hierarchy primitives (status stack, primary CTA layout).
2. Focus-mode patterns for active copy screens.
3. Practice mode IA + copy updates.
4. Progress density reduction + progressive disclosure.
5. Settings regrouping and danger-zone treatment.
