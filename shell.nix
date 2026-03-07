# Development shell. Prefer: nix develop (flake)
# Fallback for nix-shell without flakes.
{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs_25
    pkgs.nodePackages.npm
    pkgs.libsecret
  ];
  shellHook = ''
    export PATH="$PWD/node_modules/.bin:$PATH"
    [ -d node_modules ] || npm install
  '';
}
