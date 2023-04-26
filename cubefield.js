// Cubefield Game
// Based on https://www.cubefield.org.uk/
'use strict';


// TODO:
// Collision detection
// Score/high score
// Speed increase over time
// Some "advanced graphics thing" (translucency of tetrhedron? 
// special effect translucent cubes?)
// 3 levels (no side to side moving cubes, some moving cubes, all moving cubes)
// HTML level selection
// HTML game explanation

// Global WebGL context variable
let gl;

// Allow use of glMatrix values directly instead of needing the glMatrix prefix
const vec3 = glMatrix.vec3;
const vec4 = glMatrix.vec4;
const mat4 = glMatrix.mat4;
const quat = glMatrix.quat;


// stores all the objects we have
let staticObjects = [];
let objects = [];

let planeScale = 100;
let tetraScale = 0.05;
let cubeScale = 0.04;

// allocate matrices globally
let projectionMatrix = mat4.create();

let envDx = 0;
let speed = -1 / 100;

let eye = vec3.fromValues(0, 0.25, -0.75);
let horizon = vec3.fromValues(0, 0.25, 100);
let up = vec3.fromValues(0, 1, 2);

let upRotation = 0;
let dUp = 0;
let maxRight = 0.1;
let minLeft = -0.1;


// increments based on how long we've been playing
let score = 0;
let highScore = 0;

// selected from HTML
let difficulty = 0;

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
    gl.clearColor(1.0, 1.0, 1.0, 0.0); // setup the background color with red, green, blue, and alpha
    gl.enable(gl.DEPTH_TEST);

    // Initialize the WebGL program and data
    gl.program = initProgram();
    initBuffers();
    initEvents();

    initObjects();

    // set to size of window
    onWindowResize();

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
        in vec3 aColor;
        in vec2 aTextureCoord;

        vec4 lightPosition = vec4(0.0, 10.0, 0.0, 0.0);

        out vec3 vNormalVector;
        out vec3 vLightVector;
        out vec3 vEyeVector;
        flat out vec3 vColor;
        out vec2 vTextureCoord;
        
        void main() {

            mat4 mv = uViewMatrix * uModelViewMatrix;

            vec4 light = mv * lightPosition;

            vec4 P = mv * aPosition;

            vNormalVector = mat3(uModelViewMatrix) * aNormal;
            vLightVector = light.xyz;
            vEyeVector = -P.xyz;

            gl_Position = uProjectionMatrix * P;
            vColor = aColor;
            vTextureCoord = aTextureCoord;
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
        flat in vec3 vColor;
        // Vectors (varying variables from vertex shader)
        in vec3 vNormalVector;
        in vec3 vLightVector;
        in vec3 vEyeVector;

        uniform bool uTextured;
        uniform sampler2D uTexture;
        in vec2 vTextureCoord;

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
            
            vec3 color;
            if (uTextured) {
                color = texture(uTexture, vTextureCoord).rgb;
            } else {
                color = vColor;
            }

            // Compute final color
            fragColor.rgb =
                ((materialAmbient + materialDiffuse * diffuse) * color
                + materialSpecular * specular) * lightColor;
            fragColor.a = 1.0;
        }`
    );

    // Link the shaders into a program and use them with the WebGL context
    let program = linkProgram(gl, vert_shader, frag_shader);
    gl.useProgram(program);
    
    // Get the attribute indices
    program.aPosition = gl.getAttribLocation(program, 'aPosition');
    program.aColor = gl.getAttribLocation(program, 'aColor');
    program.aNormal = gl.getAttribLocation(program, 'aNormal');
    program.aTextureCoord = gl.getAttribLocation(program, 'aTextureCoord');

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
        0, 0, 0,
        0, 0, 0,
        0, 0, 0,
        0, 0, 0,
        0, 0, 0,
        0, 0, 0,
        0, 0, 0,
        0, 0, 0
    ];
    let cube_tex_coords = [
        0, 0, // A
        1, 0, // B
        1, 1, // C
        0, 1, // D
        0, 0, // E
        1, 0, // F
        1, 1, // G
        0, 1, // H
    ];
    let cubeNormals = calc_normals(Float32Array.from(cubeCoords), cubeIndices, false);

    gl.cubeVao = createVao(gl, [
        [gl.program.aPosition, cubeCoords, 3],
        [gl.program.aColor, cubeColors, 3],
        [gl.program.aNormal, cubeNormals, 3],
        [gl.program.aTextureCoord, cube_tex_coords, 2]
    ], cubeIndices);

    // The vertices, colors, and indices for a tetrahedron
    let tetraCoords = [
        0, 4/3, Math.sqrt(2/9),
        0, 0, Math.sqrt(8/9) + Math.sqrt(2/9),
        Math.sqrt(2/3), 0, 0,
        -Math.sqrt(2/3), 0, 0
    ];
    let tetraIndices = [1, 3, 0, 2, 1, 3];
    let tetraColors = [
        0, 1, 0, // green
        0, 1, 0,
        0, 1, 0, 
        0, 1, 0
    ];

    let tetraNormals = calc_normals(Float32Array.from(tetraCoords), tetraIndices, true);

    gl.tetraVao = createVao(gl, [
        [gl.program.aPosition, tetraCoords, 3], 
        [gl.program.aColor, tetraColors, 3],
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
        0.7, 0.7, 0.7,
        0.7, 0.7, 0.7,
        0.7, 0.7, 0.7,
        0.7, 0.7, 0.7
    ];
    let planeNormals = calc_normals(Float32Array.from(planeCoords), planeIndices, true);

    gl.planeVao = createVao(gl, [
        [gl.program.aPosition, planeCoords, 3], 
        [gl.program.aColor, planeColors, 3],
        [gl.program.aNormal, planeNormals, 3]
    ], planeIndices);

}

function initTextures() {

    let image = new Image();
    image.src = 'brickwall.png';
    image.addEventListener('load', () => {
        gl.cubeTexture = loadTexture(gl, image, 0);
        render();

    })

}

function generateObject(x, z) {
    let mv = mat4.scale(mat4.create(), mat4.create(), [cubeScale, cubeScale, cubeScale]);
    mat4.translate(mv, mv, [x, 1, z]);
    //allows for flexibility if we make levels with moving cubes
    // (Math.random() - 0.5) * 1 / 100
    objects.push([gl.cubeVao, gl.TRIANGLES, 36, gl.cubeTexture, mv, .1, speed, 0]);

}
function generateNewCubes() {
    for (let i = 0; i < 100; i++) {
        let x = i * 2 - 99;
        if (Math.random() < 0.07) {
            generateObject(x, 100)
        }
    }
}

function initObjects() {
    objects.push([gl.planeVao, gl.TRIANGLE_STRIP, 4, null, mat4.scale(mat4.create(), mat4.create(), [planeScale, planeScale, planeScale]), 1, 0, 0]);
    objects.push([gl.tetraVao, gl.TRIANGLE_STRIP, 6, null, mat4.scale(mat4.create(), mat4.create(), [tetraScale, tetraScale, tetraScale]), 1, 0, 0]);
}

/**
 * Initialize event handlers
 */
function initEvents() {

    //add listeners

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);

    document.getElementById('restart').addEventListener('click', restart);

}

function restart() {
    score = 0;
    objects = [];
    initObjects();
    playing = true;
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
    if(last_object > 250) {
        last_object -= 250
        generateNewCubes();
    } 

    if (dUp > 0) {
        upRotation = Math.min(maxRight, upRotation + dUp);
    } else if (dUp < 0) {
        upRotation = Math.max(minLeft, upRotation + dUp);
    }    

    updateViewMatrix(upRotation);
    gl.uniform1i(gl.program.uTexture, 0);

    for (let [vao, type, count, texture, mv, scale, dz, dx] of objects) {
        gl.bindVertexArray(vao);
        if (texture) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.uniform1i(gl.program.uTextured, 1);
        } else {
            gl.uniform1i(gl.program.uTextured, 0);
        }
        if (dz !== 0) {
            mat4.translate(mv, mv, [envDx * elapsed / scale, 0, 0]);
            mat4.translate(mv, mv, [dx * elapsed / scale, 0, dz * elapsed / scale]);
        }
        // check if mv makes the cube collide with tetrahedron

        gl.uniformMatrix4fv(gl.program.uModelViewMatrix, false, mv);
        gl.drawElements(type, count, gl.UNSIGNED_SHORT, 0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindVertexArray(null);
    }

    //remove objects that are outside of camera
    for (let i = 0; i < objects.length; i++) {
        let z = objects[i][4][14];
        if (z < -0.3) {
            objects.splice(i, 1);
            i--;
        }
        
    }
    
    if (playing) {
        score += 1;
    }
    document.getElementById('score').innerHTML = "Score: " + score;
    highScore = Math.max(score, highScore);
    document.getElementById('highscore').innerHTML = "High Score: " + highScore;

    window.requestAnimationFrame(render);


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

    if (e.keyCode === 37) {
        e.preventDefault();
        // move right
        envDx = -1 / 150;
        maxRight = 0.1;
        dUp = 0.01
    } else if (e.keyCode === 39) {
        e.preventDefault();
        // move left
        envDx = 1 / 150;
        minLeft = -0.1;
        dUp = -0.01;
    }

}

function onKeyUp(e) {

    if (e.keyCode === 37) {
        e.preventDefault();
        envDx = 0;
        maxRight = 0;
        dUp = -0.01;
    } else if (e.keyCode === 39) {
        e.preventDefault();
        envDx = 0;
        minLeft = 0;
        dUp = 0.01;
    }

    window.removeEventListener('keyUp', onKeyUp);

}
