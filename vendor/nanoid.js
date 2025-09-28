const urlAlphabet = 'useandom26T198340PX75pxJACKVeryMIYOBgL_HoFQSkh';

export function nanoid(size = 21) {
  let id = '';
  let i = size;
  while (i--) {
    id += urlAlphabet[(Math.random() * 64) | 0];
  }
  return id;
}
