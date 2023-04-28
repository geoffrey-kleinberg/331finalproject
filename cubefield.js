// Cubefield Game
// Based on https://www.cubefield.org.uk/
'use strict';


// TODO:
// improvements?

// Global WebGL context variable
let gl;

// Allow use of glMatrix values directly instead of needing the glMatrix prefix
const vec3 = glMatrix.vec3;
const vec4 = glMatrix.vec4;
const mat4 = glMatrix.mat4;
const quat = glMatrix.quat;


// stores all the objects we have
let plane;
let cubes = [];
let tetra;

let planeScale = 100;
let tetraScale = 0.03;
let cubeScale = 0.04;

// allocate matrices globally
let projectionMatrix = mat4.create();

let envDx = 0;
let speed = -1 / 100;
const MAX_SPEED = -1 / 10;

let eye = vec3.fromValues(0, 0.25, -0.75);
let horizon = vec3.fromValues(0, 0.25, 100);
let up = vec3.fromValues(0, 1, 2);

let upRotation = 0;
let dUp = 0;
let maxRight = 0.1;
let minLeft = -0.1;


// increments based on how long we've been playing
let score = 0;
let runTime = 0;
let highScores = {
    "Easy": 0,
    "Medium": 0,
    "Hard": 0,
    "Impossible": 0,
    "Luck": 0
};
let dScore = 1;

// difficulty
let difficulty;
let difficultyMultiplier = 0;

// set to false when we lose and the game will pause
// until we click HTML button to restart
let playing = true;

// Once the document is fully loaded run this init function.
window.addEventListener('load', function init() {
    // Get the HTML5 canvas object from it's ID
    const canvas = document.getElementById('webgl-canvas');
    if (!canvas) { window.alert('Could not find #webgl-canvas'); return; }

    // Get the WebGL context (save into a global variable)
    gl = canvas.getContext('webgl2');
    if (!gl) { window.alert("WebGL isn't available"); return; }

    // Configure WebGL
    gl.viewport(0, 0, canvas.width, canvas.height); // this is the region of the canvas we want to draw on (all of it)
    gl.clearColor(0.6, 0.6, 1.0, 1.0); // setup the background color with red, green, blue, and alpha

    // Initialize the WebGL program and data
    gl.program = initProgram();
    initBuffers();
    initEvents();

    initObjects();

    // translucency settings
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // set to size of window
    onWindowResize();

    difficulty = document.getElementById('difficulty').value;
    let viewMatrix = mat4.lookAt(mat4.create(), eye, horizon, up);
    gl.uniformMatrix4fv(gl.program.uViewMatrix, false, viewMatrix);

    // load texture and also render scene
    initTextures();
    
});


/**
 * Initializes the WebGL program.
 */
function initProgram() {
    // Compile shaders
    let vert_shader = compileShader(gl, gl.VERTEX_SHADER,
        `#version 300 es
        precision mediump float;

        uniform mat4 uViewMatrix;
        uniform mat4 uModelViewMatrix;
        uniform mat4 uProjectionMatrix;

        in vec4 aPosition;
        in vec3 aNormal;
        in vec4 aColor;

        vec4 lightPosition = vec4(0.0, 10.0, 0.0, 0.0);

        out vec3 vNormalVector;
        out vec3 vLightVector;
        out vec3 vEyeVector;
        flat out vec4 vColor;
        out vec3 vTextureCoord;
        
        void main() {

            mat4 mv = uViewMatrix * uModelViewMatrix;

            vec4 light = mv * lightPosition;

            vec4 P = mv * aPosition;

            vNormalVector = mat3(uModelViewMatrix) * aNormal;
            vLightVector = light.xyz;
            vEyeVector = -P.xyz;

            gl_Position = uProjectionMatrix * P;
            vColor = aColor;
            vTextureCoord = aPosition.xyz;
        }`
    );
    let frag_shader = compileShader(gl, gl.FRAGMENT_SHADER,
        `#version 300 es
        precision mediump float;

        // Material properties
        const vec3 lightColor = vec3(1.0, 1.0, 1.0);
        const float materialAmbient = 0.5;
        const float materialDiffuse = 0.6;
        const float materialSpecular = 0.2;
        const float materialShininess = 10.0;

        // Fragment base color
        flat in vec4 vColor;
        // Vectors (varying variables from vertex shader)
        in vec3 vNormalVector;
        in vec3 vLightVector;
        in vec3 vEyeVector;

        uniform bool uTextured;
        uniform samplerCube uTexture;
        in vec3 vTextureCoord;

        // Output color of the fragment
        out vec4 fragColor;
        
        void main() {
            // Normalize vectors
            vec3 N = normalize(vNormalVector);
            vec3 L = normalize(vLightVector);
            vec3 E = normalize(vEyeVector);

            // Compute lighting
            float diffuse = dot(-L, N);
            float specular = 0.0;
            if (diffuse < 0.0) {
                diffuse = 0.0;
            } else {
                vec3 R = reflect(L, N);
                specular = pow(max(dot(R, E), 0.0), materialShininess);
            }
            
            vec4 color;
            if (uTextured) {
                color = texture(uTexture, vTextureCoord);
            } else {
                color = vColor;
            }

            // Compute final color
            fragColor.rgb =
                ((materialAmbient + materialDiffuse * diffuse) * color.rgb
                + materialSpecular * specular) * lightColor;
            fragColor.a = vColor.a;
        }`
    );

    // Link the shaders into a program and use them with the WebGL context
    let program = linkProgram(gl, vert_shader, frag_shader);
    gl.useProgram(program);
    
    // Get the attribute indices
    program.aPosition = gl.getAttribLocation(program, 'aPosition');
    program.aColor = gl.getAttribLocation(program, 'aColor');
    program.aNormal = gl.getAttribLocation(program, 'aNormal');

    // Get the uniform indices
    program.uProjectionMatrix = gl.getUniformLocation(program, 'uProjectionMatrix');
    program.uModelViewMatrix = gl.getUniformLocation(program, 'uModelViewMatrix');
    program.uViewMatrix = gl.getUniformLocation(program, 'uViewMatrix');
    program.uTexture = gl.getUniformLocation(program, 'uTexture');
    program.uTextured = gl.getUniformLocation(program, 'uTextured');
    
    return program;
}


function initBuffers() {
    // create buffers for cube/tetrahedron data
    // create buffer for horizon

    // The vertices, colors, and indices for a cube
    let cubeCoords = [
        1, 1, 1, // A
        -1, 1, 1, // B
        -1, -1, 1, // C
        1, -1, 1, // D
        1, -1, -1, // E
        -1, -1, -1, // F
        -1, 1, -1, // G
        1, 1, -1, // H
    ];
    let cubeIndices = [
        1, 2, 0, 2, 3, 0,
        7, 6, 1, 0, 7, 1,
        1, 6, 2, 6, 5, 2,
        3, 2, 4, 2, 5, 4,
        6, 7, 5, 7, 4, 5,
        0, 3, 7, 3, 4, 7,
    ];
    let cubeColors = [
        0, 0, 0, 1,
        0, 0, 0, 1,
        0, 0, 0, 1,
        0, 0, 0, 1,
        0, 0, 0, 1,
        0, 0, 0, 1,
        0, 0, 0, 1,
        0, 0, 0, 1
    ];
    let cubeNormals = calc_normals(Float32Array.from(cubeCoords), cubeIndices, false);

    gl.cubeVao = createVao(gl, [
        [gl.program.aPosition, cubeCoords, 3],
        [gl.program.aColor, cubeColors, 4],
        [gl.program.aNormal, cubeNormals, 3]
    ], cubeIndices);

    // The vertices, colors, and indices for a tetrahedron
    let tetraCoords = [
        0, 4/3, Math.sqrt(2/9),
        0, 0, Math.sqrt(2),
        Math.sqrt(2/3), 0, 0,
        -Math.sqrt(2/3), 0, 0
    ];
    let tetraIndices = [1, 3, 0, 2, 1, 3];
    let tetraAlpha = 0.5;
    let tetraColors = [
        1, 0, 0, tetraAlpha,// green
        1, 0, 0, tetraAlpha,
        1, 0, 0, tetraAlpha,
        1, 0, 0, tetraAlpha
    ];

    let tetraNormals = calc_normals(Float32Array.from(tetraCoords), tetraIndices, true);

    gl.tetraVao = createVao(gl, [
        [gl.program.aPosition, tetraCoords, 3], 
        [gl.program.aColor, tetraColors, 4],
        [gl.program.aNormal, tetraNormals, 3]
    ], tetraIndices);

    let planeCoords = [
        1, 0, 1,
        -1, 0, 1,
        1, 0, -1,
        -1, 0, -1
    ];
    let planeIndices = [3, 1, 2, 0];
    let planeColors = [
        0.4, 1, 0.4, 1,
        0.4, 1, 0.4, 1,
        0.4, 1, 0.4, 1,
        0.4, 1, 0.4, 1
    ];
    let planeNormals = calc_normals(Float32Array.from(planeCoords), planeIndices, true);

    gl.planeVao = createVao(gl, [
        [gl.program.aPosition, planeCoords, 3], 
        [gl.program.aColor, planeColors, 4],
        [gl.program.aNormal, planeNormals, 3]
    ], planeIndices);

}

function initTextures() {

    let image = new Image();
    image.src = 'brickwall.png';
    image.addEventListener('load', () => {
        gl.cubeTexture = loadCubemapTexture(gl, image, image, image, image, image, image, 0);
        render();

    })

}

function generateObject(x, z) {
    let mv = mat4.scale(mat4.create(), mat4.create(), [cubeScale, cubeScale, cubeScale]);
    mat4.translate(mv, mv, [x, 1, z]);

    // need to draw these first for translucency, so add them at the beginning of array
    cubes.push([gl.cubeVao, gl.TRIANGLES, 36, gl.cubeTexture, mv, .1, speed, (Math.random() - 0.5) * difficultyMultiplier]);

}
function generateNewCubes() {
    for (let i = 0; i < 100; i++) {
        let x = i * 2 - 99;
        if (Math.random() < 0.07) {
            generateObject(x, -10000 * speed)
        }
    }
}

function initObjects() {
    plane = [gl.planeVao, gl.TRIANGLE_STRIP, 4, null, mat4.scale(mat4.create(), mat4.create(), [planeScale, planeScale, planeScale]), 1, 0, 0];
    tetra = [gl.tetraVao, gl.TRIANGLE_STRIP, 6, null, mat4.scale(mat4.create(), mat4.create(), [tetraScale, tetraScale, tetraScale]), 1, 0, 0];
}

/**
 * Initialize event handlers
 */
function initEvents() {

    //add listeners

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);

    document.getElementById('restart').addEventListener('click', restart);

    document.getElementById('difficulty').addEventListener('input', changeDifficulty);

}

function restart() {
    score = 0;
    cubes = [];
    envDx = 0;
    upRotation = 0;
    dUp = 0;
    runTime = 0;
    speed = -1 / 100;
    playing = true;
    // needed here to reset dScore
    setDifficulty();
}

function changeDifficulty() {
    difficulty = document.getElementById('difficulty').value;
    setDifficulty();
    restart();
}

function setDifficulty() {
    if (difficulty === "Easy") {
        difficultyMultiplier = 0;
        dScore = 1;
    } else if (difficulty === "Medium") {
        difficultyMultiplier = 1 / 500;
        dScore = 1.5;
    } else if (difficulty === "Hard") {
        difficultyMultiplier = 1 / 250;
        dScore = 2;
    } else if (difficulty === "Impossible") {
        difficultyMultiplier = 1 / 100;
        dScore = 3;
    } else if (difficulty === "Luck") {
        difficultyMultiplier = 1 / 50;
        dScore = 5;
    }
}

let last_redraw;
let last_object = 0;
let elapsed;
/**
 * Render the scene.
 */
function render(ms) {
    // Clear the current rendering
    gl.clear(gl.COLOR_BUFFER_BIT);

    // animation
    if (!ms) { ms = last_redraw = performance.now(); }
    elapsed = ms - last_redraw;
    last_redraw = ms;
    
    if (!playing) {
        elapsed = 0;
    }
    
    last_object += elapsed
    let delay = -2.5 / speed
    if(last_object > delay) {
        last_object -= delay
        generateNewCubes();
    } 

    if (dUp > 0) {
        upRotation = Math.min(maxRight, upRotation + dUp);
    } else if (dUp < 0) {
        upRotation = Math.max(minLeft, upRotation + dUp);
    }    

    updateViewMatrix(upRotation);

    drawObject(plane);

    for (let cube of cubes) {
        let [mv, scale, dz, dx] = cube.slice(4);
        mat4.translate(mv, mv, [(dx + envDx) * elapsed / scale, 0, dz * elapsed / scale]);
        // check if mv makes the cube collide with tetrahedron
        checkCollision(mv);
        drawObject(cube);
    }
    drawObject(tetra);

    //remove objects that are outside of camera
    for (let i = 0; i < cubes.length; i++) {
        let z = cubes[i][4][14];
        if (z < -0.3) {
            cubes.splice(i, 1);
            i--;
        }
        
    }
    
    if (playing) {
        score += dScore;
        runTime += 1;
    }
    document.getElementById('score').innerHTML = "Score: " + Math.round(score);
    highScores[difficulty] = Math.max(score, highScores[difficulty]);
    document.getElementById('hs' + difficulty).innerHTML = "High Score (" + difficulty +"): " + Math.round(highScores[difficulty]);
    if (runTime % 100 === 0) {
        dScore *= 1.025;
        // max becuase they're negative
        speed = Math.max(speed * 1.01, MAX_SPEED);
    }

    window.requestAnimationFrame(render);


}

function drawObject(obj) {
    let [vao, type, count, texture, mv] = obj;
    gl.bindVertexArray(vao);
    if (texture) {
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
        gl.uniform1i(gl.program.uTextured, 1);
    } else {
        gl.uniform1i(gl.program.uTextured, 0);
    }
    gl.uniformMatrix4fv(gl.program.uModelViewMatrix, false, mv);
    gl.drawElements(type, count, gl.UNSIGNED_SHORT, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
}

function checkCollision(mv) {
    // helps with collision detection at high speeds
    let collisionOffset = -1 * speed * 0.05;
    let centerX = mv[12];
    let centerZ = mv[14];

    let tetraPointZ = Math.sqrt(2) * tetraScale + collisionOffset;
    let tetraRightX = Math.sqrt(2/3) * tetraScale + collisionOffset;
    let tetraLeftX = -Math.sqrt(2/3) * tetraScale - collisionOffset;

    let baseZ = centerZ - cubeScale - collisionOffset;
    let backZ = centerZ + cubeScale + collisionOffset;
    let leftX = centerX - cubeScale - collisionOffset;
    let rightX = centerX + cubeScale + collisionOffset;
    // check if front line of cube intersects tetrahedron
    let x0 = (baseZ - tetraPointZ) / Math.sqrt(3);
    if (x0 >= tetraLeftX && x0 <= collisionOffset && x0 >= leftX && x0 <= rightX) {
        playing = false;
    }
    let x1 = (baseZ - tetraPointZ) / -Math.sqrt(3);
    if (x1 <= tetraRightX && x1 >= -1 * collisionOffset && x1 >= leftX && x1 <= rightX) {
        playing = false;
    }

    // check if left line of cube intersects tetrahedron
    let z0 = leftX * Math.sqrt(3) + tetraScale * Math.sqrt(2);
    if (z0 >= -1 * collisionOffset && z0 <= tetraPointZ && z0 >= baseZ && z0 <= backZ) {
        playing = false;
    }
    let z1 = leftX * -Math.sqrt(3) + tetraScale * Math.sqrt(2);
    if (z1 >= -1 * collisionOffset && z1 <= tetraPointZ && z1 >= baseZ && z1 <= backZ) {
        playing = false;
    }

    // check if right line of cube intersects tetrahedron
    z0 = rightX * Math.sqrt(3) + tetraScale * Math.sqrt(2);
    if (z0 >= -1 * collisionOffset && z0 <= tetraPointZ && z0 >= baseZ && z0 <= backZ) {
        playing = false;
    }
    z1 = rightX * -Math.sqrt(3) + tetraScale * Math.sqrt(2);
    if (z1 >= -1 * collisionOffset && z1 <= tetraPointZ && z1 >= baseZ && z1 <= backZ) {
        playing = false;
    }
    
}

/**
 * Keep the canvas sized to the window.
 */
function onWindowResize() {
    let [w, h] = [window.innerWidth, window.innerHeight];
    gl.canvas.width = w;
    gl.canvas.height = h;
    gl.viewport(0, 0, w, h);
    updateProjectionMatrix();
}

function updateProjectionMatrix() {
    // Create the perspective projection matrix
    let [w, h] = [gl.canvas.width, gl.canvas.height];
    let fovy = Math.PI / 4;
    let aspect = w / h;
    let near = 0.01;
    let far = 100;

    // Update projection matrix uniform
    mat4.perspective(projectionMatrix, fovy, aspect, near, far);
    gl.uniformMatrix4fv(gl.program.uProjectionMatrix, false, projectionMatrix);
}

function updateViewMatrix(angle) {

    let rotation = mat4.fromRotation(mat4.create(), angle, [0, 0, 1]);

    let thisUp = vec3.transformMat4(vec3.create(), up, rotation)

    let viewMatrix = mat4.lookAt(mat4.create(), eye, horizon, thisUp);
    gl.uniformMatrix4fv(gl.program.uViewMatrix, false, viewMatrix);
}

function onKeyDown(e) {
    window.addEventListener('keyup', onKeyUp);

    if (e.keyCode === 37 && playing) {
        e.preventDefault();
        // move right
        envDx = -1 / 150;
        maxRight = 0.1;
        minLeft = 0;
        dUp = 0.01
    } else if (e.keyCode === 39 && playing) {
        e.preventDefault();
        // move left
        envDx = 1 / 150;
        minLeft = -0.1;
        maxRight = 0;
        dUp = -0.01;
    } else if (e.keyCode === 82) {
        restart();
    }

}

function onKeyUp(e) {

    if (e.keyCode === 37 && playing) {
        e.preventDefault();
        envDx = 0;
        maxRight = 0;
        minLeft = 0;
        dUp = -0.01;
    } else if (e.keyCode === 39 && playing) {
        e.preventDefault();
        envDx = 0;
        minLeft = 0;
        maxRight = 0;
        dUp = 0.01;
    }

    window.removeEventListener('keyUp', onKeyUp);

}
