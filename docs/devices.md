# Device checks

Waypoint must work on a phone and on a tablet. Two kinds of check cover this: the smoke tests, which a computer runs, and the manual checklist, which a person runs on a real iPhone and a real iPad.

## Smoke tests

The tests are in `tests/e2e`. They start the app on port 3150, on 127.0.0.1 only, with a scratch database, so they never touch `data/`. The app gets only the few settings it needs. It runs from a scratch copy of the code that has no `.env`, so no Claude key, no Drive key and no claims file of the real setup can reach it. Each run makes new passwords and writes them to `/tmp/waypoint-e2e/credentials.json` (mode 600). Claude is off (no key, no CLI). The tests cover sign-in, the setup wizard, the job detail (the route, Your way in, Your CV, Back on a phone) and the CV build with its preview.

There are 6 profiles: iPhone 15, Pixel 7, iPad (gen 7) in portrait, iPad (gen 7) in landscape, iPad Pro 12.9 in portrait and Desktop 1440.

Stop any server on port 3150 before you run the tests. The first run compiles each page, so it is slow on the Pi (the server may take up to 4 minutes to start).

### In the cloud (Chromium only)

The cloud container has Chromium and no WebKit. Do not run `playwright install` there. This command runs all 6 profiles in Chromium, with the screen size, touch and user agent of each device:

```
WAYPOINT_E2E_CHROMIUM_ONLY=1 npm run test:e2e
```

### On the Raspberry Pi (WebKit)

On the Pi, the iPhone and iPad profiles run in WebKit. WebKit needs a supported 64-bit Debian or Ubuntu release. Install WebKit and its system libraries one time (the second command needs sudo), then run the tests:

```
npx playwright install webkit
sudo npx playwright install-deps webkit
npm run test:e2e
```

The Pixel 7 and Desktop profiles use Chromium. If the Pi has no Chromium for Playwright, run `npx playwright install chromium` too.

A test writes its screenshot to `/tmp/waypoint-e2e-results/shots/<profile>/`. The test report and the traces are in `/tmp/waypoint-e2e-results/`.

### After a forced stop

A normal run and a stop with Ctrl+C stop the app and the worker. If you kill the run by force (kill -9, or a power cut), the app and the worker can stay. The next run then says "Port 3150 is in use". Stop them:

```
ps -eo pid,args | grep -E 'next dev|scripts/worker'
kill <the PIDs of those lines>
```


## Manual checklist

Use a real iPhone and a real iPad, with Safari. Open Waypoint through its public link. Do each check on both devices, unless the line says one device. Write down what fails and on which device.

### The on-screen keyboard over forms

- [ ] Open a sheet with fields (Add a job, the filters). Tap a field. The keyboard opens. The field stays visible above the keyboard.
- [ ] Tap the last field of a long form, for example the note in Your way in or "What to change" in Your CV. The field and its button stay in view.
- [ ] Close the keyboard. The page goes back to its place. Nothing stays hidden or jumps.
- [ ] A field does not zoom the page when you tap it.

### The Files picker

Open Profile, then the Imports tab. For each type, tap the upload button. The Files picker opens, and the chosen file uploads.

- [ ] A `.pdf` file (a résumé)
- [ ] A `.tex` file (your own LaTeX source)
- [ ] A `.zip` file (a LinkedIn export)
- [ ] A `.yml` file (claims.yml)

For each one, check that Waypoint shows the result or a clear error, and that the picker does not offer files of the wrong type.

### The home-screen app

- [ ] In Safari, use Share, then Add to Home Screen. The name and the icon are right.
- [ ] Open the app from the home screen. It opens with no browser bars.
- [ ] The top of the page is not under the status bar. The bottom is not under the home indicator.
- [ ] You stay signed in after you close and open the app.

### Rotation

- [ ] Open a job. Rotate the device. The same job stays open and the page does not jump to the top.
- [ ] On the iPhone, open a part of the job (Your way in or Your CV). Rotate. The part stays open.
- [ ] On the iPad, the layout changes between portrait and landscape and nothing scrolls sideways.

### The PDF preview

- [ ] Build a CV. The preview shows the pages of the PDF.
- [ ] The pages scroll with one finger, and the page behind does not scroll at the same time.
- [ ] Open opens the PDF in a new tab. Download saves it to Files.

### The floating tab bar (iPhone)

- [ ] The tab bar floats above the home indicator. Nothing of the bar is under the indicator.
- [ ] The tab bar does not cover the last item of a list or the Apply bar. Scroll to the end to check.
- [ ] Each tab is easy to hit with a thumb.
