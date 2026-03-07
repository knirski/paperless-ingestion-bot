{
  description = "Signal and Gmail document ingestion for Paperless-ngx";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {
      packages.${system} = {
        default = pkgs.callPackage ./default.nix { };
        paperlessIngest = pkgs.callPackage ./default.nix { };
      };

      devShells.${system}.default = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs_24
          pkgs.nodePackages.npm
          pkgs.libsecret
        ];
        shellHook = ''
          export PATH="$PWD/node_modules/.bin:$PATH"
          [ -d node_modules ] || npm install
        '';
      };

      formatter.${system} = pkgs.nixfmt;
    };
}
