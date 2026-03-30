{ pkgs, ... }: {
  channel = "stable-24.11";

  packages = [
    pkgs.rustup
    pkgs.nodejs_20
  ];

  idx.extensions = [];

  idx.previews = {
    enable = true;
    previews = {};
  };
}
