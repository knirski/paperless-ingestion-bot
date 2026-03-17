# Standalone Nix package for paperless-ingestion-bot.
# Used by flake.nix when published independently.
# Uses bun2nix for dependency fetching.

{ pkgs, bun2nix }:

let
  packageJson = builtins.fromJSON (builtins.readFile ./package.json);
  src = builtins.path {
    path = ./.;
    name = "paperless-ingestion-bot-src";
    filter = path: _:
      builtins.baseNameOf path != "node_modules"
      && builtins.baseNameOf path != ".git"
      && builtins.baseNameOf path != "result"
      && builtins.baseNameOf path != "coverage";
  };
in
pkgs.stdenv.mkDerivation rec {
  pname = "paperless-ingestion-bot";
  inherit (packageJson) version;
  inherit src;

  nativeBuildInputs = [ bun2nix.hook pkgs.bun ];
  bunDeps = bun2nix.fetchBunDeps { bunNix = ./bun.nix; };
  buildInputs = [ pkgs.libsecret ];

  dontUseBunBuild = true;

  buildPhase = "bun run build";

  installPhase = ''
    mkdir -p $out/lib/node_modules/paperless-ingestion-bot
    cp -r package.json bun.lock node_modules dist config.example.json .nvmrc $out/lib/node_modules/paperless-ingestion-bot/
    mkdir -p $out/bin
    echo '#!${pkgs.runtimeShell}
    exec ${pkgs.nodejs_24}/bin/node "$out/lib/node_modules/paperless-ingestion-bot/dist/cli.js" "$@"' > $out/bin/paperless-ingestion-bot
    chmod +x $out/bin/paperless-ingestion-bot
  '';
}
