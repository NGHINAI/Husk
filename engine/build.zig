const std = @import("std");

/// Husk engine build script — wraps the upstream lightpanda build.
/// In Milestone 1 this is a thin pass-through; Milestone 2 adds our
/// patches as additional source files / build steps.
pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Defer to upstream lightpanda's build.zig. We invoke it as a child
    // process via `zig build` against the submodule path. In Milestone 2
    // we will switch to importing upstream as a package and applying
    // patches inline.
    const upstream_build = b.addSystemCommand(&.{
        "zig", "build",
        "-Doptimize=ReleaseSafe",
    });
    upstream_build.cwd = b.path("upstream");

    const build_step = b.step("default", "Build the husk engine via upstream lightpanda");
    build_step.dependOn(&upstream_build.step);
    b.default_step.dependOn(build_step);

    _ = target;
    _ = optimize;
}
