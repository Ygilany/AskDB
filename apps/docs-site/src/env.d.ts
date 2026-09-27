// Starlight >=0.42 ships compiled JS without declarations for its virtual modules;
// declare the ones our component overrides import.
declare module "virtual:starlight/user-config" {
  const config: import("@astrojs/starlight/types").StarlightConfig;
  export default config;
}

declare module "virtual:starlight/components/*" {
  const Component: import("astro/runtime/server/index.js").AstroComponentFactory;
  export default Component;
}
