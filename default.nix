# Standalone Nix package for paperless-ingestion-bot.
# Used by flake.nix when published independently.

{ pkgs }:

let
  packageJson = builtins.fromJSON (builtins.readFile ./package.json);
  src = builtins.path {
    path = ./.;
    name = "paperless-ingestion-bot-src";
    filter = path: type:
      builtins.baseNameOf path != "node_modules"
      && builtins.baseNameOf path != "dist"
      && builtins.baseNameOf path != ".git"
      && builtins.baseNameOf path != "result";
  };
  npmDepsHash = "sha256-/SuIS/N9Ds9nHyFmiP2AY2yVjS2DrAX2b9e/hq7vLUU=";
in
pkgs.buildNpmPackage rec {
  pname = "paperless-ingestion-bot";
  version = packageJson.version;
  inherit src npmDepsHash;
  nodejs = pkgs.nodejs_24;
  npmBuildScript = "build";
  buildInputs = [ pkgs.libsecret ];
  nativeBuildInputs = [ pkgs.pkg-config ];
  doCheck = true;
  checkPhase = ''
    export PATH="${pkgs.biome}/bin:$PATH"
    npm run check
  '';
  installPhase = ''
    mkdir -p $out/lib/node_modules/paperless-ingestion-bot
    cp -r dist package.json package-lock.json node_modules $out/lib/node_modules/paperless-ingestion-bot/
    mkdir -p $out/bin
    echo '#!${pkgs.runtimeShell}
    exec ${pkgs.nodejs_24}/bin/node "${placeholder "out"}/lib/node_modules/paperless-ingestion-bot/dist/cli.js" "$@"' > $out/bin/paperless-ingestion-bot
    chmod +x $out/bin/paperless-ingestion-bot
  '';
}
