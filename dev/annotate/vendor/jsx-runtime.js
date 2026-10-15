// "react/jsx-runtime" for the vendored agentation toolbar: jsx(type, props, key) is
// createElement with the key folded into props.
const R = window.React;
export const Fragment = R.Fragment;
export const jsx = (type, props, key) => R.createElement(type, key === undefined ? props : { ...props, key });
export const jsxs = jsx;
