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
  npmDepsHash = "sha256-S1XpaHorSu1XUdL5MMOeseBr2oOozCW85iEO5SqLaBA=";
in
pkgs.buildNpmPackage rec {
  pname = "paperless-ingestion-bot";
  version = packageJson.version;
  inherit src npmDepsHash;
  nodejs = pkgs.nodejs_24;
  npmBuildScript = "build";
  buildInputs = [ pkgs.libsecret ];
  nativeBuildInputs = [ pkgs.pkg-config ];
  # Skip check: CI runs npm run check in check.yml.
  # nix-run-if-missing for rumdl/typos/actionlint/shellcheck; Nix build sandbox
  # cannot run those. See docs/CI.md.
  dontCheck = true;
  installPhase = ''
    mkdir -p $out/lib/node_modules/paperless-ingestion-bot
    cp -r dist package.json package-lock.json node_modules $out/lib/node_modules/paperless-ingestion-bot/
    mkdir -p $out/bin
    echo '#!${pkgs.runtimeShell}
    exec ${pkgs.nodejs_24}/bin/node "${placeholder "out"}/lib/node_modules/paperless-ingestion-bot/dist/cli.js" "$@"' > $out/bin/paperless-ingestion-bot
    chmod +x $out/bin/paperless-ingestion-bot
  '';
}
