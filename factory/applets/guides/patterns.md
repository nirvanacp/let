# Implementation patterns

## Layout

```text
applet.json
src/main.tsx              mount with the router options
src/routes.ts             the router's routes, overlay screens and sign-in URL
src/app.tsx               the screen switch and the tabs
src/page.ts               definePageModule: the readers and commands
src/pages/*.ts            page module code: one file per sort of page or shared reader, imported by src/page.ts
src/model.ts              data types shared by the page module and screens
src/screens/*.tsx         one file per screen, such as compose.tsx for the applet's composer
src/components/*.tsx      shared rows, skeletons, sheets, attachment previews
src/actions.ts            the message for a failed user action
src/library.ts            record and service access: the service client, hooks and validation
src/theme.css             tokens and base styles
backend/                  optional service
```

The page module imports only `@let/sdk/page` and pure helpers; `check` and `build` reject a page module that imports `@let/sdk/react`. Screens import `@let/sdk/react`. Share types, not code with side effects, between them; the page module is bundled separately and runs inside the website's page. Extract a helper only after a second real use.

## Page modules

Write readers for each sort of page the site has, with a `ready` read per route as positive evidence and small, pure `read` functions. Name the nodes each read touches with `extent` or `dependsOn`, give every item a stable unique key, and express commands as desired state. [Page modules](page-modules.md) covers each of these; [interactions](interactions.md) covers commands and inputs.

## The screen switch

```tsx
export function App() {
  const { screen } = useRouter();
  const Screen = screen ? SCREENS[screen.id] : undefined;
  return <div className="app">
    <main className="content">{Screen && <Screen key={screen!.key} />}</main>
    <Tabs />
  </div>;
}
```

`screen` is `null` while the active context shows a page without a route; the website shows then, so render nothing for it. Key each screen by `screen.key` so a new history entry gets fresh component state. To give the switch direction, wrap the slot in an unkeyed stage that animates a copy of the outgoing screen, and keep a sheet's base screen mounted under it; [motion](motion.md#the-stage-and-the-ghost-layer) shows the full version.

## Screens

```tsx
const FEED_PAGES = [{ pattern: "/" }, { pattern: "/newest" }];

function FeedScreen() {
  const page = useRouter().status();
  const stories = useWatch<never, Story>("feed:stories", { reader: "stories" }, { when: FEED_PAGES });
  if (stories.order.length === 0) {
    if (page.status === "ready" && stories.status === "ready") return <Empty />;
    if (page.status === "error" || stories.status === "error") return <LoadError error={page.error ?? stories.error} />;
    return <FeedSkeleton />;
  }
  return <ScrollMemory className="screen" aria-busy={page.stale || page.status === "loading"}>
    {page.status === "error" && <p className="inline-error" role="alert">Couldn't refresh. Showing the last copy.</p>}
    {stories.order.map(key => <StoryRow key={key} id={key} />)}
  </ScrollMemory>;
}

const StoryRow = memo(function StoryRow({ id }: { id: string }) {
  const story = useRecord<Story>("feed:stories", id);
  return story ? <Row story={story} /> : null;
});
```

- Handle each state: loading, empty, error, stale and the watch's own error. `auth` and pages without a route show the website, so screens do not draw a sign-in wall of their own. See [presentation](presentation.md).
- Render `stale` content with an unobtrusive refreshing state instead of a skeleton.
- Name each watch after its screen and reader (`feed:stories`), and guard it with `when` to the URLs of the screen's routes, so it reads only on its own pages and two screens can watch the same reader.
- Read the screen's lists with `useWatch` and each row with `useRecord` in a memoized row component keyed by the record key, so an update to one record renders one row.
- Read another context with `useWatch(id, spec, { context })` and `useRouter().status(contextId)` only for what the screen needs, such as the account name on a Me tab.
- Put each screen's scroll container in `ScrollMemory`.

## Composers and attachments

A composer is a screen, usually on the route of the site's composer URL. It holds the user's text in component state and the picked files in `useFilePicker`, shows each file with its `previewUrl` and a Remove button, and on Post fills the site's editor, attaches the files and clicks the site's Post button with evidence. Keep the draft after a failure. Put the previews in one component the composer and replies share. [Website features](website-features.md#post-with-photos-or-video) has the full screen.

Website dialogs need nothing: Genesis shows them over the applet. Call every user action (`files.pick`, `downloads.save`, `share`, `links.openExternal`, `notifications.enable`, `allow`) first in its tap handler, and turn its errors into a message with one shared helper.

## Records and services

Wrap storage and service calls in one module, `src/library.ts`, that screens call; split it into more modules only once it grows. Keep one authoritative store per record type and say which in the current spec. Validate stored values when reading; treat a missing or malformed record as absent, not as a crash. See [services and data](services-and-data.md).

## Performance

A covered website rests unless the applet is using it: Genesis pauses its drawing and timers, and every call, input and navigation wakes it first (see [how a covered page runs](page-control.md#how-a-covered-page-runs)). The applet's part is to leave it resting:

- Never keep a page busy to "keep it warm". Do not poll with `read`, and do not run a timer that calls the page; records arrive through watches when the page changes.
- Bound every list in the reader's selector and with `limit`; a page is at most 192 KiB of JSON. Render a list over 50 rows with `VirtualList` from `@let/sdk/react`, or in pages, not all at once.
- Memoize rows by key, and select a single record with `useRecord` so that one change re-renders one row.
- Keep images lazy and sized: `width`, `height`, `loading="lazy"` and `decoding="async"` on every `<img>`.
- Hold a page (`useHold`) only for work it does alone, such as playing music, and release the hold when that work ends.

The applet's screens run in their own renderer, apart from the websites, so a busy website does not stall a tap on the applet. The applet's part:

- Render stale first. Genesis keeps each watch's last value and shows it at once, as `stale`, while the page reads again. Draw the screen from that value; show a skeleton only when `watchStatus` is `loading` (see [presentation](presentation.md#loaders-and-skeletons)).
- Keep event handlers short. Work that takes more than about 50 ms, such as sorting or filtering hundreds of records, runs in slices with `await scheduler.yield()` (or `setTimeout(0)` where it is missing) between them, so taps still land.
- Keep the bundle small. `genesis-applet check` and `build` warn when the UI's JavaScript is over 350 KiB gzip or the page script over 100 KiB gzip. A warning does not fail the build, but a clean applet has none.
