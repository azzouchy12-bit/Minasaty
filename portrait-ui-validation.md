# Portrait UI validation

The local preview loaded `public/student-live.html` successfully.

At desktop preview viewport 1280x1100, `html` had class `student-desktop-mode`. Computed geometry remained:

| Element | Width | Height | Left | Top | Position |
|---|---:|---:|---:|---:|---|
| `.viewer-shell` | 1280px | 1100px | 0px | 0px | relative |
| `.viewer-stage` | 1280px | 1100px | 0px | 0px | relative |
| `.video-frame` | 1024px | 1100px | 0px | 0px | absolute |
| `.student-chat-panel` | 256px | 699px | 1024px | 52px | absolute |
| `.viewer-actions-divider` | 256px | 349px | 1024px | 751px | absolute |

This confirms the desktop 80/20 geometry is unchanged by the `student-portrait.css` rewrite. The file contains one portrait-only media query and no rules outside it.

## Mobile screenshot validation

A Chromium headless screenshot at 390x844 confirmed the portrait shell renders as a fixed mobile app surface. The pre-join dialog is centered and the fixed bottom toolbar is now behind the dialog because `.student-prejoin-overlay` has portrait z-index 1000 while the toolbar uses z-index 120. No desktop CSS file was changed.

## Requested vertical ordering test

The portrait grid was changed to zero gap and zero side padding, with the video filling the upper row and the chat row constrained to `minmax(11rem, 22dvh)`. The fixed bottom toolbar remains unchanged at `3.85rem`.

A temporary preview with the pre-join overlay hidden confirmed the header is at the top, video is directly below it, chat follows the video, and the bottom toolbar remains fixed. The chat action row needs an explicit reserved height/stacking guarantee so the camera/send buttons remain visible above the fixed toolbar in the live state.

## Chat action visibility fix

The chat action row is now fixed immediately above the unchanged bottom toolbar at `bottom: 3.85rem` with z-index 110. The temporary 390x844 preview visibly shows the two buttons (`تصوير`, `إرسال`) between the chat card and the bottom toolbar. The message compose state hides this row so it cannot cover the modal.

## Top gap removal

Explicit portrait-only resets were added for `body.student-live-page`, `.viewer-shell`, `.viewer-header`, and `.viewer-stage`: fixed inset shell, zero margin, and zero padding. A fresh 390x844 preview shows the header starting at the first pixel of the page with no blank dark strip above it. The bottom toolbar remains in its original fixed position.

## Black overlay diagnosis and fix

The mobile CSS had the empty `#remote-video` above `.video-placeholder` at z-index 2. Because the video element itself had a black background and remained visible before a live video track arrived, it covered the center of the waiting artwork while the artwork remained visible only around it.

Portrait-only fix: hide `#remote-video` when it does not have `.has-live-video`, keep `.video-placeholder` above it, and restore the video above the placeholder only when the live-video class is present. The WebRTC JavaScript already toggles `.has-live-video` when a live video track arrives.

## Chat panel height

The portrait chat row maximum was changed from `22dvh` to `44dvh`, doubling its viewport-based height while leaving the fixed bottom toolbar at `3.85rem`. A 390x844 preview shows the chat frame substantially taller and the camera/send row still visible above the unchanged bottom toolbar.

## Landscape four-button toolbar

Landscape rules now use four equal grid columns. The intended order is RTL: cancel rotation, raise hand, capture, and refresh media. A local CSS test with the rotated class and the capture button placed in the toolbar measured four equal columns and visible controls for all four buttons. Portrait and desktop selectors remain unchanged; cache-busting query parameters were updated so phones receive the new files.

## Virtual landscape black strip diagnosis

The black strip came from `inset: auto !important` overriding `top: 0` and `left: 0` on the rotated fixed stage. The stage was therefore laid out outside the viewport before the 90-degree transform. Replacing that conflict with `right: auto` and `bottom: auto` keeps the pre-rotation stage at the viewport origin. The corrected 390x844 virtual preview no longer has the stage displaced or an empty central strip; the remaining black area is the intentional video surface while no live media stream is connected.

## Portrait rotate-button preview

The actual `#student-center-rotate-btn` click was tested from a 390x844 portrait viewport using a local Socket.io stub and preview-only auth bypass. The click now produces `student-landscape-mode student-virtual-landscape-mode`; the cancel-rotation button becomes visible and the capture button is reparented into the toolbar. The preview confirms four equal toolbar columns. The production code was not changed for the preview auth bypass.

## Native fullscreen landscape preview

The native fullscreen surface was previewed locally after the portrait rotate button was clicked. The app surface used the `html:fullscreen` rules from `student-landscape.css`; the Android fullscreen hint itself remains system-owned. The toolbar measured four equal columns of 93px at a 390x844 viewport, with cancel rotation, capture, and refresh visible. The raise-hand element remained `hidden` in the mock because the preview did not simulate the live-class permission/state that reveals it; its CSS slot is present and the production state controls whether it is shown.

## Horizontal native fullscreen preview

The corrected fullscreen preview was captured at 844x390 after the blue portrait rotate button was clicked. The fullscreen toolbar has four equal 206.5px columns; cancel rotation and capture are visible, and capture is parented to `.viewer-actions-control-row`. The mock still keeps raise-hand hidden because no live permission state was simulated. No production deployment was performed for this preview.
