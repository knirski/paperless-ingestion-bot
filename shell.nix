# Development shell. Prefer: nix develop (flake)
# Fallback for nix-shell without flakes.
{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  buildInputs = [
    pkgs.bun
    pkgs.libsecret
  ];
  shellHook = ''
    export PATH="$PWD/node_modules/.bin:$PATH"
    [ -d node_modules ] || bun install
  '';
}
