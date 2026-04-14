# Exercise Import Template — Instructions

## How to use

1. Open `exercise-import-template.csv` in Excel or Google Sheets
2. **Darren fills in columns A–F** (the green columns below)
3. **Leave columns G–O blank** — Claude will generate the AI metadata
4. Save as CSV when done

---

## Columns Darren fills in (REQUIRED)

| Column | Field           | What to enter                                                                                                                      | Example                                                   |
| ------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A      | **name**        | Exercise name                                                                                                                      | Barbell Back Squat                                        |
| B      | **description** | Short description of the exercise                                                                                                  | A compound lower-body exercise targeting quads and glutes |
| C      | **category**    | One or more from: `strength`, `strength_endurance`, `flexibility`, `plyometric`, `power`, `mobility` (comma-separated if multiple) | strength                                                  |
| D      | **difficulty**  | One of: `beginner`, `intermediate`, `advanced`                                                                                     | intermediate                                              |
| E      | **equipment**   | Free-text equipment needed                                                                                                         | Barbell + Squat Rack                                      |
| F      | **video_url**   | YouTube link (optional, leave blank if none)                                                                                       | https://youtube.com/watch?v=...                           |

## Columns Claude fills in (AI METADATA — leave blank)

| Column | Field                  | Valid values                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G      | **instructions**       | Step-by-step execution cues                                                                                                                                                                                                                                                                                                                                                                                 |
| H      | **movement_pattern**   | `push`, `pull`, `squat`, `hinge`, `lunge`, `carry`, `rotation`, `isometric`, `locomotion`                                                                                                                                                                                                                                                                                                                   |
| I      | **primary_muscles**    | Comma-separated from: `chest`, `upper_back`, `lats`, `shoulders`, `biceps`, `triceps`, `forearms`, `core`, `obliques`, `lower_back`, `glutes`, `quadriceps`, `hamstrings`, `calves`, `hip_flexors`, `adductors`, `abductors`, `traps`, `neck`                                                                                                                                                               |
| J      | **secondary_muscles**  | Same muscle options as above                                                                                                                                                                                                                                                                                                                                                                                |
| K      | **force_type**         | `push`, `pull`, `static`, `dynamic`                                                                                                                                                                                                                                                                                                                                                                         |
| L      | **laterality**         | `bilateral`, `unilateral`, `alternating`                                                                                                                                                                                                                                                                                                                                                                    |
| M      | **equipment_required** | Comma-separated from: `barbell`, `dumbbell`, `kettlebell`, `cable_machine`, `smith_machine`, `resistance_band`, `pull_up_bar`, `bench`, `squat_rack`, `leg_press`, `leg_curl_machine`, `lat_pulldown_machine`, `rowing_machine`, `treadmill`, `bike`, `box`, `plyo_box`, `medicine_ball`, `stability_ball`, `foam_roller`, `trx`, `landmine`, `sled`, `battle_ropes`, `agility_ladder`, `cones`, `yoga_mat` |
| N      | **is_bodyweight**      | `TRUE` or `FALSE`                                                                                                                                                                                                                                                                                                                                                                                           |
| O      | **training_intent**    | Comma-separated from: `build`, `shape`, `express`                                                                                                                                                                                                                                                                                                                                                           |

---

## Tips

- One exercise per row
- For **category**, if an exercise fits multiple categories use commas: `strength,plyometric`
- **video_url** is optional — leave blank if you don't have one yet
- The example row in the template shows a completed entry for reference
- Delete the example row before importing
