/**
 * Minimal ambient declaration for the slice of the OpenSeadragon UMD build the
 * viewer island uses. `openseadragon@3.1.0` ships without bundled type
 * definitions and `@types/openseadragon` is not a dependency; rather than reach
 * for `any` (forbidden), we declare only the surface `viewer.ts` touches. Widen
 * this as the island grows.
 */
declare module 'openseadragon' {
  export interface Viewport {
    zoomBy(factor: number): Viewport;
    goHome(immediately?: boolean): Viewport;
    applyConstraints(immediately?: boolean): Viewport;
  }

  export interface Viewer {
    viewport: Viewport;
    addHandler(eventName: string, handler: (event: unknown) => void): void;
    destroy(): void;
  }

  export interface GestureSettings {
    clickToZoom?: boolean;
    dblClickToZoom?: boolean;
    scrollToZoom?: boolean;
    pinchToZoom?: boolean;
    flickEnabled?: boolean;
  }

  export interface ImageTileSource {
    type: 'image';
    url: string;
  }

  export interface Options {
    element?: HTMLElement;
    tileSources?: string | ImageTileSource;
    prefixUrl?: string;
    crossOriginPolicy?: 'Anonymous' | 'use-credentials' | false;
    showNavigationControl?: boolean;
    showZoomControl?: boolean;
    showHomeControl?: boolean;
    showFullPageControl?: boolean;
    showSequenceControl?: boolean;
    showNavigator?: boolean;
    gestureSettingsMouse?: GestureSettings;
    gestureSettingsTouch?: GestureSettings;
    minZoomImageRatio?: number;
    maxZoomPixelRatio?: number;
    visibilityRatio?: number;
    constrainDuringPan?: boolean;
    animationTime?: number;
    springStiffness?: number;
    immediateRender?: boolean;
  }

  export default function OpenSeadragon(options: Options): Viewer;
}
