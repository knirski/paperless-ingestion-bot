{
  description = "Signal and Gmail document ingestion for Paperless-ngx";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";
    bun2nix.url = "github:nix-community/bun2nix?tag=2.0.8";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, flake-utils, bun2nix }:
    flake-utils.lib.eachSystem [ "x86_64-linux" "aarch64-linux" ] (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        checks = {
          default = pkgs.callPackage ./default.nix { inherit (bun2nix.packages.${system}) bun2nix; };
          nix-lint = pkgs.runCommand "nix-lint" { } ''
            cp -r ${self} /tmp/check-src
            cd /tmp/check-src
            ${pkgs.statix}/bin/statix check .
            ${pkgs.deadnix}/bin/deadnix --exclude bun.nix .
            touch $out
          '';
        };

        packages = {
          default = pkgs.callPackage ./default.nix { inherit (bun2nix.packages.${system}) bun2nix; };
          inherit (pkgs) statix deadnix typos actionlint lychee shellcheck shfmt;
          bun2nix = bun2nix.packages.${system}.default;
          update-bun-nix = pkgs.writeShellApplication {
            name = "update-bun-nix";
            runtimeInputs = [ pkgs.bun bun2nix.packages.${system}.default ];
            text = ''
              bun install
              bun2nix -o bun.nix
              echo "Regenerated bun.nix" >&2
            '';
          };
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            statix
            deadnix
            typos
            actionlint
            lychee
            shellcheck
            shfmt
            libsecret
          ];
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            [ -d node_modules ] || bun install
          '';
        };

        formatter = pkgs.nixfmt;
      }
    );
}
