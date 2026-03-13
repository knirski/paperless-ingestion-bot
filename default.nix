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
  npmDepsHash = "sha256-e5D3S7RqXpclfqm863YEZz0NPsNVjfwh+njQnEEnpXE=";
in
pkgs.buildNpmPackage rec {
  pname = "paperless-ingestion-bot";
  version = packageJson.version;
  inherit src npmDepsHash;
  nodejs = pkgs.nodejs_24;
  npmBuildScript = "build";
  buildInputs = [ pkgs.libsecret ];
  nativeBuildInputs = [ pkgs.pkg-config ];
  # Skip check: CI runs npm run check. Biome's platform binary fails in the Nix
  # sandbox (expects /lib64/ld-linux-x86-64.so.2). Alternatives if you need
  # check here:
  #
  # (1) autoPatchelf:
  #   buildInputs = [ pkgs.libsecret pkgs.glibc ];
  #   nativeBuildInputs = [ pkgs.pkg-config pkgs.autoPatchelfHook ];
  #   doCheck = true;
  #   checkPhase = ''
  #     autoPatchelf node_modules/@biomejs/cli-linux-x64/
  #     npm run check
  #   '';
  #
  # (2) buildFHSEnv (add fhsCheckEnv to let block):
  #   fhsCheckEnv = pkgs.buildFHSEnv {
  #     name = "paperless-ingestion-bot-check";
  #     targetPkgs = pkgs: with pkgs; [ nodejs_24 nodePackages.npm libsecret ];
  #     runScript = "bash";
  #   };
  #   doCheck = true;
  #   checkPhase = ''
  #     ${fhsCheckEnv}/bin/paperless-ingestion-bot-check -c "npm run check"
  #   '';
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
