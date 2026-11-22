// Web only. Captures the rendered export card (a DOM element on
// react-native-web) to a PNG object URL. react-native-view-shot cannot do
// it on web: captureRef calls findNodeHandle, which react-native-web refuses.

import html2canvas from 'html2canvas';

export async function captureCardUrl(node, { width, height }) {
  let canvas = await html2canvas(node, {
    scale: width / node.offsetWidth,
    backgroundColor: null,
    logging: false,
    // The card is parked far above the page (top: -10000). In the clone,
    // put it back in the page, or html2canvas renders it empty.
    // shortcut: assumes the offscreen container is the card's direct parent (EntryEditorScreen), walk up to it if a wrapper View is added.
    onclone: (doc, clone) => {
      clone.parentElement.style.top = '0px';
    },
  });
  if (canvas.width !== width || canvas.height !== height) {
    const sized = document.createElement('canvas');
    sized.width = width;
    sized.height = height;
    sized.getContext('2d').drawImage(canvas, 0, 0, width, height);
    canvas = sized;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The card image could not be created.');
  return URL.createObjectURL(blob);
}
