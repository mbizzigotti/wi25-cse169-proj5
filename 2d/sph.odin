package main
import "core:fmt"
import "core:time"
import "vendor:raylib"
import "core:math/rand"
import "core:math/linalg"

WIDTH  :: 800;
HEIGHT :: 600;

//Ball :: struct {
//    position: raylib.Vector2,
//    speed: raylib.Vector2,
//    radius: f32,
//    color: raylib.Color,
//}

vec2 :: [2] f32;
particle_radius: f32 : 2;

sub_steps : i32 = 4;

position : [] vec2;
velocity : [] vec2;
density  : [] f32;

Grid_Bucket :: struct {
    count: u8,
    indices: [8] u16,
};

grid_dim : [2] i32;
grid : [] Grid_Bucket;

particle_count :: 400;

grid_position :: proc(pos: vec2) -> [2] i32 {
    pos := pos / smoothing_radius;
    return { cast(i32) pos.x, cast(i32) pos.y };
} 

create_grid :: proc() {
    grid_dim = {cast (i32) (WIDTH / smoothing_radius) + 1, cast (i32) (HEIGHT / smoothing_radius) + 1};
    grid = make([] Grid_Bucket, grid_dim.x * grid_dim.y, context.temp_allocator);

    for &cell in grid {
        cell.count = 0;
    }

    for i in 0..<particle_count {
        gpos := grid_position(position[i]);
        cell := &grid[gpos.y * grid_dim.x + gpos.x];
        
        if cell.count >= 8 { continue; }

        cell.indices[cell.count] = cast(u16) i;
        cell.count += 1;
    }
}

for_each_neighbor :: proc(particle_index: int, callback: proc(int,int) -> $T, initial: T) -> T {
    sum := initial;
    base := grid_position(position[particle_index]);
    
    for y in -1..=1 {
        for x in -1..=1 {
            gpos := base + {cast(i32) x, cast(i32) y};

            if gpos.x < 0 \
            || gpos.y < 0 \
            || gpos.x >= grid_dim.x \
            || gpos.y >= grid_dim.y {
                continue;
            }

            cell := &grid[gpos.y * grid_dim.x + gpos.x];

            for i in 0..<cell.count {
                sum += callback(particle_index, cast(int) cell.indices[i]);
            }
        }
    }

    return sum;
}

create :: proc() {
    position = make([] vec2, particle_count);
    velocity = make([] vec2, particle_count);
    density  = make([] f32,  particle_count);
}

reset :: proc() {
    for i in 0..<particle_count {
        position[i] = { rand.float32_range(0, WIDTH), rand.float32_range(0, HEIGHT) }
        velocity[i] = 0;
    }
}

draw :: proc() {
    for i in 0..<particle_count {
        color := raylib.BLACK;
        mag := linalg.length(velocity[i]);
        when true {
            color.r = cast(u8) (mag);
            color.g = cast(u8) (mag);
            color.b = cast(u8) (mag);
            color.a = 255;
        }
        raylib.DrawCircleV(position[i], particle_radius, color);
    }
    raylib.DrawCircleLinesV(raylib.GetMousePosition(), smoothing_radius, raylib.BLACK);
}

shader_file_path :: "density.frag";
shader_mod_time: i64;
shader: raylib.Shader;
shader_locations: struct {
    smoothing_radius: i32,
    target_density: i32,
    positions: i32,
}

main :: proc() {
    raylib.InitWindow(WIDTH, HEIGHT, "Bouncing Ball in Odin")
    defer raylib.CloseWindow()

    raylib.SetTargetFPS(120);
    raylib.GuiLoadStyle("style_cyber.rgs")

    shader_mod_time = raylib.GetFileModTime(shader_file_path);

    // Load raymarching shader
    // NOTE: Defining 0 (NULL) for vertex shader forces usage of internal default vertex shader
    shader = raylib.LoadShader(nil, shader_file_path);

    // Get shader locations for required uniforms
    get_shader_locations();

    create();
    reset();

    last_tick := time.tick_now();
    
    for !raylib.WindowShouldClose() {
        if raylib.IsKeyPressed(raylib.KeyboardKey.R) {
            reset();
        }
        if raylib.IsKeyPressed(raylib.KeyboardKey.F) {
            fixed = !fixed;
        }

        reload_shaders();

        duration := time.tick_lap_time(&last_tick)
        real_dt := cast(f32) time.duration_seconds(duration)
        dt := min(real_dt, 1.0/60.0)

        create_grid();
        
        for _ in 0..<sub_steps {
            update(dt / cast(f32) sub_steps);
        }
        
        raylib.BeginDrawing()
        raylib.ClearBackground(raylib.BLACK)
        
        when true {
            raylib.SetShaderValue (shader, shader_locations.smoothing_radius, &smoothing_radius, raylib.ShaderUniformDataType.FLOAT);
            raylib.SetShaderValue (shader, shader_locations.target_density,   &target_density,   raylib.ShaderUniformDataType.FLOAT);
            raylib.SetShaderValueV(shader, shader_locations.positions, raw_data(position), raylib.ShaderUniformDataType.VEC2, particle_count);
            raylib.BeginShaderMode(shader);
            raylib.DrawRectangle(0, 0, WIDTH, HEIGHT, raylib.WHITE);
            raylib.EndShaderMode();
        }

        when false { // Draw debug grid
            for y in 0..<grid_dim.y {
                for x in 0..<grid_dim.x {
                    cell := &grid[y * grid_dim.x + x];
                    X := x * cast(i32) smoothing_radius;
                    Y := y * cast(i32) smoothing_radius;
                    raylib.DrawRectangleLines(X,Y, cast(i32) smoothing_radius, cast(i32) smoothing_radius, raylib.RED);
                    raylib.DrawText(fmt.caprint(cell.count), X, Y, 20, raylib.BLACK);
                }
            }
        }

        draw();
        
        raylib.DrawRectangle(WIDTH-200-5, 0, 200+5, cast(i32) gui_context.y, {0, 0, 0, 200})
        gui_context.y = 5;

        ui_text("{:.1f} FPS", 1 / real_dt)
        ui_text("{:.6f}", density_at(raylib.GetMousePosition()))
        ui_spinner("Sub Steps", &sub_steps, 1, 24);
        ui_slider("Gravity", &gravity.y, 0, 100);
        ui_slider("h", &smoothing_radius, 50, 200);
        ui_slider("Target", &target_density, 0, 0.002);
        ui_slider("PM", &pressure_multiplier, 0, 200);

        raylib.EndDrawing()
        
        free_all(context.temp_allocator);
    }
}

gui_context : struct {
    y: f32,
};

ui_slider :: proc(label: string, value: ^f32, min, max: f32) {
    //raylib.GuiSlider({WIDTH-100-5,gui_context.y,100,12}, fmt.caprintf("{} {:.3f}", label, value^, allocator=context.temp_allocator), "", value, min, max);
    raylib.GuiSliderBar({WIDTH-100-5,gui_context.y,100,12}, fmt.caprintf("{} {:.3f}", label, value^, allocator=context.temp_allocator), "", value, min, max);
    gui_context.y += 16;
}

ui_spinner :: proc(label: string, value: ^i32, min, max: i32) {
    raylib.GuiSpinner({WIDTH-100-5,gui_context.y,100,16}, fmt.caprintf("{} ", label, allocator=context.temp_allocator), value, min, max, false);
    gui_context.y += 20;
}

ui_text :: proc(format: string, args: ..any) {
    raylib.GuiLabel({WIDTH-100-5,gui_context.y,100,12}, fmt.caprintf(format, ..args, allocator=context.temp_allocator));
    gui_context.y += 16;
}

reload_shaders :: proc() {
    current_mod_time := raylib.GetFileModTime(shader_file_path);

    // Check if shader file has been modified
    if (current_mod_time != shader_mod_time)
    {
        // Try reloading updated shader
        updated_shader := raylib.LoadShader(nil, shader_file_path);

        if (updated_shader.id > 0) // It was correctly loaded
        {
            raylib.UnloadShader(shader);
            shader = updated_shader;

            // Get shader locations for required uniforms
            //resolutionLoc = GetShaderLocation(shader, "resolution");
            //mouseLoc = GetShaderLocation(shader, "mouse");
            //timeLoc = GetShaderLocation(shader, "time");

            // Reset required uniforms
            //SetShaderValue(shader, resolutionLoc, resolution, SHADER_UNIFORM_VEC2);
        }

        shader_mod_time = current_mod_time;
    }
}

get_shader_locations :: proc() {
    shader_locations = {
        smoothing_radius = raylib.GetShaderLocation(shader, "smoothing_radius"),
        target_density   = raylib.GetShaderLocation(shader, "target_density"),
        positions        = raylib.GetShaderLocation(shader, "positions"),
    };
}
