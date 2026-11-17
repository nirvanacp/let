# Verifying a servelet

Check the servelet alone first, then the journey through the applet on a device.

## check

```sh
npx let-servelet check servelets/notes
```

`check` builds the module, loads it in Node with a throwaway database, sends `GET <healthPath>` and requires a 2xx status, then sends each request in `checks.json` in order on the same database and compares its status:

```json
[
  { "method": "POST", "path": "/v1/notes", "body": { "id": "n1", "title": "First", "body": "" }, "expectStatus": 201 },
  { "method": "GET", "path": "/v1/notes/n1", "expectStatus": 200 },
  { "method": "PUT", "path": "/v1/notes/n1", "body": { "title": "Stale", "body": "", "revision": 9 }, "expectStatus": 409 },
  { "method": "GET", "path": "/v1/notes/missing", "expectStatus": 404 }
]
```

Cover every route, each validation rule that answers 400, each conflict that answers 409, and a repeated create. Keep `checks.json` in the servelet directory and update it with every route change. It prints the module's size and sha256.

## run

```sh
npx let-servelet run servelets/notes --port 8790
curl -s -X POST http://127.0.0.1:8790/v1/notes -d '{"id":"n2","title":"Two","body":""}'
curl -s 'http://127.0.0.1:8790/v1/notes?limit=10'
```

`run` serves the module over plain HTTP on `127.0.0.1` for manual requests, with the database `dist/run.sqlite3` unless `--database <file>` names another. Use it to explore answers and to test a migration on a database the previous build made. It stops with Ctrl-C. `check` and `run` have no time limit and run the code in Node, so run only servelets you trust.

## On a device

1. Build and check the applet that uses the servelet: `npm run check` and `npm run build` in the applet directory. `dist/servelets/<serviceId>/servelet.wasm` exists afterwards.
2. Install it with `genesis-applet dev install . --device <serial>` and walk each journey that reads or writes the servelet's records: create, edit, delete, a conflict where the applet offers one, Back, and leaving and reopening the applet. Records must persist across a force stop.
3. Check the failure paths the applet shows: an empty list, a record that is gone, and a stale edit.
4. Record the evidence in the applet's current spec: device, build, what was walked and what was not.

Cost: `adb -s <serial> logcat -s servelet` prints one line per request with its time in milliseconds. Walk each screen and treat a request over 100 ms on the phone as a finding: look for a missing index, a list read without a limit, or several requests where one would do.

Clear data and Remove in Applet info delete the servelet's database; use them only when a journey needs a fresh start and the user allows losing the records.
