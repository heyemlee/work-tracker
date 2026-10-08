/**
 * What React does to a page whose markup doesn't match what its server sent: the document's root element is thrown
 * away with all that's in it, and another put in its place.
 */
export function rebuildDocument(doc: Document = document): void {
  const root = doc.createElement('html');
  root.append(doc.createElement('head'), doc.createElement('body'));
  doc.documentElement.remove();
  doc.append(root);
}
