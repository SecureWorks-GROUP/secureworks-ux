// One import point for the view layer (Preact + htm, vendored, no build step).
import { h, render, Fragment, createContext } from '../../vendor/preact.js';
import {
  useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useContext, useReducer
} from '../../vendor/preact-hooks.js';
import htm from '../../vendor/htm.js';

export const html = htm.bind(h);
export {
  h, render, Fragment, createContext,
  useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useContext, useReducer
};

/** Join class names, skipping falsy ones. */
export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}
