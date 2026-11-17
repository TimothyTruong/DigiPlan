# Petal (placeholder name)

A soft, pastel, Notion-style **student life planner** for the web. Calendar, assignments, exams and countdowns, with class notes,
links and files in one place, plus **Google Calendar** sync. Includes small MVPs for meals and recipes, fitness, habits and wellness, and budget.

```bash
npm install
cp .env.example .env.local   # optional: add VITE_GOOGLE_CLIENT_ID for Google Calendar
npm run dev
```

## Features
- **Today**: countdowns, schedule, to-dos with automatic carry-over, habits, meals, mood/water/sleep check-in.
- **Calendar**: month, week and list views (the list view is the "collapsed" agenda), filters by type and class, recurring events (daily, weekdays, weekly on chosen days, every 2 weeks, monthly, yearly, with end dates and skipped dates).
- **Tasks**: assignments, tasks and exams grouped by Overdue / Today / Next 7 days / Later. Assignments can have steps, and quick-add guesses the type from words like "exam" or "essay".
- **Classes**: a cover and icon per class; markdown notes with checkboxes; links; files (stored in the browser); a grade calculator (current average, and what you need on the rest to hit a target).
- **Google Calendar**: shows events from the calendars you pick, and pushes planner items back to Google. `.ics` timetable import.
- **Meals**: recipe book (photos, tags, favourites), weekly meal plan, "copy last week", send ingredients to the grocery list.
- **Fitness**: plan or log workouts with sets, reps and weight; weekly stats; streaks; "repeat week".
- **Habits & Wellness**: habits with a weekly target (a rest day doesn't break a 3×/week streak); 30-day mood, energy, sleep and water trends where missed days show as gaps.
- **Budget**: planned vs actual by category, income, money left.
- **Make it yours**: each page has its own colour, cover and icon (presets or your own uploads), and light, dark or system mode.
- Shortcuts: `N` adds anything, `1`–`8` jump between pages, `⌘↵` saves.

Data is local-first (IndexedDB). Export/import backups in Settings. See `CLAUDE.md` for architecture.
