export const canPopOut = () => "documentPictureInPicture" in window;

/** Opens the always-on-top window. Chrome only allows this straight after a click. */
export async function openPopOut(): Promise<Window> {
  const win: Window = await (window as any).documentPictureInPicture.requestWindow({ width: 380, height: 680 });
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    win.document.head.appendChild(node.cloneNode(true));
  });
  win.document.title = "Timbre";
  return win;
}
