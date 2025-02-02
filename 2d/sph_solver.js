function add_slider(obj, label, min, max) {
    function to_slider(x) {
        return 1000 * (x - min) / (max - min);
    }
    function from_slider(x) {
        return (x / 1000) * (max - min) + min;
    }
    const controls = document.getElementById("controls");
    
    // Create a container for the slider
    const sliderContainer = document.createElement("div");
    sliderContainer.style.display = "flex";
    sliderContainer.style.alignItems = "center";
    sliderContainer.style.gap = "10px";
    sliderContainer.style.width = "100%";
    
    // Create label for the slider
    const label_element = document.createElement("label");
    label_element.textContent = label;
    label_element.style.minWidth = "300px";
    label_element.style.textAlign = "right";
    label_element.style.pointerEvents = "none"; // Allow touch/mouse events to fall through
    
    // Create the slider input
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 1000;
    slider.value = to_slider(obj[label]);
    slider.style.width = "200px";
    
    // Create span to show the value
    const valueDisplay = document.createElement("input");
    valueDisplay.type = "text";
    valueDisplay.value = obj[label];
    valueDisplay.style.width = "50px";
    valueDisplay.style.textAlign = "center";

    // Update slider when valueDisplay changes
    valueDisplay.addEventListener("change", function () {
        obj[label] = parseFloat(valueDisplay.value);
    });
    
    // Update value when slider changes
    slider.addEventListener("input", function () {
        const new_value = from_slider(parseFloat(slider.value));
        obj[label] = new_value;
        valueDisplay.value = new_value;
    });
    
    // Append elements to container
    sliderContainer.appendChild(label_element);
    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(valueDisplay);
    
    // Append slider container to controls
    controls.appendChild(sliderContainer);
}

function clamp(x, a, b) {
    return x < a ? a : x > b ? b : x;
}

const default_constants = {
    gravity:            0.05,
    radius:             5,
    smoothingLength:    50,     // Smoothing length for SPH
    pressureMultiplier: 1000.0,
    restDensity:        1.0,    // Rest density for the fluid
    gasConstant:        3.0,    // Gas constant for pressure calculation
    viscosity:          0.001,  // Viscosity constant
};

document.addEventListener("DOMContentLoaded", function () {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");

    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = canvas.width;
    offscreenCanvas.height = canvas.height;
    const offscreenCtx = offscreenCanvas.getContext("2d");

    const numParticles = 200;
    const constants = JSON.parse(JSON.stringify(default_constants));

    add_slider(constants, "gravity",            0.0,  1.0);
    add_slider(constants, "restDensity",        0.0,  1.0);
    add_slider(constants, "smoothingLength",    10.0, 200.0);
    add_slider(constants, "pressureMultiplier", 0.5,  20.0);

    let   posX     = new Float32Array(numParticles);
    let   posY     = new Float32Array(numParticles);
    const velX     = new Float32Array(numParticles);
    const velY     = new Float32Array(numParticles);
    const density  = new Float32Array(numParticles);
    const pressure = new Float32Array(numParticles);
    let min, max;

    function reset() {
        posX = posX.map(() => Math.random() * canvas.width);
        posY = posY.map(() => Math.random() * canvas.height);
        velX.fill(0);
        velY.fill(0);
        density.fill(0);
        pressure.fill(0);
    }

    document.addEventListener('keydown', (e) => {
        switch (e.key) {
            case 'r': reset(); break;
            case 'p':
                console.log(constants.gravity, constants.restDensity);
            break;
        }
    });

    function smoothing_kernel(radius, dist) {
        const q = dist / radius;
        if (q >= 2.0) return 0.0;
        const t0 = 1.0 - q * 0.5;
        const t1 = 2.0 * q + 1.0;
        return t0 * t0 * t0 * t0 * t1;
    }

    function smoothing_kernel_grad(radius, dist) {
        const q = dist / radius;
        if (q >= 2.0) return 0.0;
        const t0 = 1.0 - q * 0.5;
        const t1 = 2.0 * q + 1.0;
        const t2 = t0 * t0 * t0;
        return 2.0 * t2 * (t0 - t1);
    }

    function kernel_volume(radius) {
        const constant = 0.557042300822; // 7 / 4pi
        return constant / radius * radius;
    }

    function computeDensity() {
        min = 1e10; max = -1e10;
        for (let i = 0; i < numParticles; i++) {
            let d = 0;
            for (let j = 0; j < numParticles; j++) {
                const dx = posX[i] - posX[j];
                const dy = posY[i] - posY[j];
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < constants.smoothingLength) {
                    // Using a simple inverse distance function for density calculation
                    d += smoothing_kernel(constants.smoothingLength, distance);
                }
            }
            d /= kernel_volume(constants.smoothingLength);
            density[i] = d;
            if (d < min) min = d;
            if (d > max) max = d;
            //pressure[i] = Math.max(0, constants.gasConstant * (density[i] - constants.restDensity));  // Avoid negative pressure
            pressure[i] = constants.gasConstant * (density[i] - constants.restDensity);
        }
    }

    function renderDensityMap() {
        const imageData = ctx.createImageData(canvas.width, canvas.height);

        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                let d = 0;
                for (let i = 0; i < numParticles; i++) {
                    const dx = posX[i] - x;
                    const dy = posY[i] - y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < constants.smoothingLength) {
                        d += smoothing_kernel(constants.smoothingLength, distance);
                    }
                }
                d /= kernel_volume(constants.smoothingLength);

                const index = (y * canvas.width + x) * 4;
                const intensity = ((d - min) / (max - min)) * 255;  // Adjust scaling factor for visualization

                imageData.data[index]     = 255;  // Red
                imageData.data[index + 1] = 0;  // Green
                imageData.data[index + 2] = 255;  // Blue
                imageData.data[index + 3] = 255;        // Alpha
            }
        }

        //offscreenCtx.putImageData(imageData, 0, 0);
        //ctx.drawImage(offscreenCanvas, 0, 0);
        ctx.putImageData(imageData, 20, 20);
    }

    function updateParticles(dt) {
        for (let i = 0; i < numParticles; i++) {
            velY[i] += constants.gravity * dt;
            posX[i] += velX[i] * dt;
            posY[i] += velY[i] * dt;
        }
    }

    function handleCollisions() {
        for (let i = 0; i < numParticles; i++) {
            // Collision with bottom
            if (posY[i] + constants.radius > canvas.height) {
                posY[i] = canvas.height - constants.radius;
                velY[i] *= -0.8;  // Invert velocity and apply damping
            }
            // Collision with top
            if (posY[i] - constants.radius < 0) {
                posY[i] = constants.radius;
                velY[i] *= -0.8;  // Invert velocity and apply damping
            }
            // Collision with right
            if (posX[i] + constants.radius > canvas.width) {
                posX[i] = canvas.width - constants.radius;
                velX[i] *= -0.8;  // Invert velocity and apply damping
            }
            // Collision with left
            if (posX[i] - constants.radius < 0) {
                posX[i] = constants.radius;
                velX[i] *= -0.8;  // Invert velocity and apply damping
            }
        }
    }

    function applyForces(dt) {
        for (let i = 0; i < numParticles; i++) {
            let forceX = 0, forceY = 0;
            for (let j = 0; j < numParticles; j++) {
                if (i !== j) {
                    const dx = posX[i] - posX[j];
                    const dy = posY[i] - posY[j];
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < constants.smoothingLength) {
                        // Pressure force
                        const pressureForce = constants.pressureMultiplier * (pressure[i] + pressure[j]) / (2 * density[i] * density[j]) * smoothing_kernel_grad(constants.smoothingLength, distance);
                        forceX -= pressureForce * dx / distance;
                        forceY -= pressureForce * dy / distance;

                        // Viscosity force
                    //    const viscosityForce = viscosity * (velX[j] - velX[i]) * Math.pow(smoothingLength - distance, 2);
                    //    forceX += viscosityForce * dx / distance;
                    //    forceY += viscosityForce * dy / distance;
                    }
                }
            }
            velX[i] += forceX * dt;
            velY[i] += forceY * dt;
            //velX[i] = forceX;
            //velY[i] = forceY;
        }
    }

    function drawParticles() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < numParticles; i++) {
            ctx.beginPath();
            ctx.arc(posX[i], posY[i], constants.radius, 0, Math.PI * 2);
            ctx.fillStyle = ((i) => {
                const vx = velX[i];
                const vy = velY[i];
                const value = Math.sqrt(vx * vx + vy * vy);
                const k = clamp(Math.round(value * 10.0), 0, 255);
                const o = `#${k.toString(16).padStart(2, '0')}00FF`;
                //console.log(o);
                return o;
            })(i);
            ctx.fill();
        }
    }

    let prev = null;

    reset();

    function loop(timestamp) {
        const dt = prev !== null? Math.min((timestamp - prev)*0.001, 0.016) : 0.00001;

        computeDensity();
        applyForces(dt);
        updateParticles(dt);
        handleCollisions();  // Call collision handler here
        renderDensityMap();
        drawParticles();

        prev = timestamp;
        requestAnimationFrame(loop);
    }

    loop();
});
