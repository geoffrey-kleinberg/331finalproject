// Cubefield Game
// Based on https://www.cubefield.org.uk/
// Authors: Braden Kirkpatrick, Geoffrey Kleinberg
'use strict';


// Global WebGL context variable
let gl;

// Allow use of glMatrix values directly instead of needing the glMatrix prefix
const vec3 = glMatrix.vec3;
const mat4 = glMatrix.mat4;


// stores all the objects we have
let plane;
let cubes = [];
let tetra;

// defines the scale of the objects
const PLANE_SCALE = 100;
const TETRA_SCALE = 0.03;
const CUBE_SCALE = 0.04;

// allocate matrices globally
let projectionMatrix = mat4.create();

// keeps track of movement of environment
let envDx = 0;
let speed = -1 / 100;
const MAX_SPEED = -1 / 10;

// defines the view matrix
let eye = vec3.fromValues(0, 0.25, -0.75);
let horizon = vec3.fromValues(0, 0.25, 100);
let up = vec3.fromValues(0, 1, 2);

// keeps track of rotation
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

    // gets the initial difficulty
    difficulty = document.getElementById('difficulty').value;

    // sets the default view matrix
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
            
            // texture is only used for objects with texture
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
            // brickwall.png has translucency, so we use original alpha
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


/**
 * Initializs the buffers for all objects
 */
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
    // eslint-disable-next-line no-undef
    let cubeNormals = calc_normals(Float32Array.from(cubeCoords), cubeIndices, false);

    // eslint-disable-next-line no-undef
    gl.cubeVao = createVao(gl, [
        [gl.program.aPosition, cubeCoords, 3],
        [gl.program.aColor, cubeColors, 4],
        [gl.program.aNormal, cubeNormals, 3]
    ], cubeIndices);

    // The vertices, colors, and indices for a tetrahedron
    // elevated slightly off the ground (to avoid translucency issues)
    let tetraCoords = [
        0, 4/3, Math.sqrt(2/9), // top
        0, 0.005, Math.sqrt(2), // front
        Math.sqrt(2/3), 0.005, 0, // back right
        -Math.sqrt(2/3), 0.005, 0 // back left
    ];
    let tetraIndices = [2, 1, 3, 0, 2, 1];
    tetraIndices = [3, 2, 1, 0, 3, 2];
    let tetraAlpha = 0.5;
    let tetraColors = [
        1, 0, 0, tetraAlpha,// green
        1, 0, 0, tetraAlpha,
        1, 0, 0, tetraAlpha,
        1, 0, 0, tetraAlpha
    ];

    // eslint-disable-next-line no-undef
    let tetraNormals = calc_normals(Float32Array.from(tetraCoords), tetraIndices, true);

    // eslint-disable-next-line no-undef
    gl.tetraVao = createVao(gl, [
        [gl.program.aPosition, tetraCoords, 3], 
        [gl.program.aColor, tetraColors, 4],
        [gl.program.aNormal, tetraNormals, 3]
    ], tetraIndices);

    // The vertices, colors, and indices for a plane
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
    // eslint-disable-next-line no-undef
    let planeNormals = calc_normals(Float32Array.from(planeCoords), planeIndices, true);

    // eslint-disable-next-line no-undef
    gl.planeVao = createVao(gl, [
        [gl.program.aPosition, planeCoords, 3], 
        [gl.program.aColor, planeColors, 4],
        [gl.program.aNormal, planeNormals, 3]
    ], planeIndices);

}

/**
 * Initializes the brick wall texture
 */
function initTextures() {

    let image = new Image();
    image.src = 'brickwall.png';
    image.addEventListener('load', () => {
        // load it as a cubemap so it appears on all sides of the cube
        // eslint-disable-next-line no-undef
        gl.cubeTexture = loadCubemapTexture(gl, image, image, image, image, image, image, 0);
        render();

    })

}

/**
 * Generates a new cube at the specified (x, z) location
 */
function generateObject(x, z) {
    let mv = mat4.scale(mat4.create(), mat4.create(), [CUBE_SCALE, CUBE_SCALE, CUBE_SCALE]);
    mat4.translate(mv, mv, [x, 1, z]);

    cubes.push([gl.cubeVao, gl.TRIANGLES, 36, gl.cubeTexture, mv, .1, speed, (Math.random() - 0.5) * difficultyMultiplier]);
}

/**
 * Generates a row of cubes
 */
function generateNewCubes() {
    for (let i = 0; i < 100; i++) {
        // aligns the x to a grid
        let x = i * 2 - 99;
        // 7% chance of generating a cube at each location
        if (Math.random() < 0.07) {
            // make it farther away based on the speed we are traveling
            generateObject(x, -10000 * speed)
        }
    }
}

/**
 * Initializes the global variables for the plane and tetrahedron
 */
function initObjects() {
    plane = [gl.planeVao, gl.TRIANGLE_STRIP, 4, null, mat4.scale(mat4.create(), mat4.create(), [PLANE_SCALE, PLANE_SCALE, PLANE_SCALE]), 1, 0, 0];
    tetra = [gl.tetraVao, gl.TRIANGLE_STRIP, 6, null, mat4.scale(mat4.create(), mat4.create(), [TETRA_SCALE, TETRA_SCALE, TETRA_SCALE]), 1, 0, 0];
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

/**
 * Restarts the game (score, cubes, speed, etc)
 */
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

/**
 * Sets the difficulty and restarts when the HTML is interacted with
 */
function changeDifficulty() {
    difficulty = document.getElementById('difficulty').value;
    setDifficulty();
    restart();
}

/**
 * Sets difficultyMultiplier and dScore based on difficulty
 */
function setDifficulty() {
    // difficultyMultiplier gets multiplied by the random to determine x velocity
    // dScore increases on harder difficulty so we get points faster
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


// animation variables
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
    
    // generates new objects after a certain delay based on speed
    last_object += elapsed
    let delay = -2.5 / speed
    if(last_object > delay) {
        last_object -= delay
        generateNewCubes();
    } 

    // if we are rotating, then rotate
    if (dUp > 0) {
        upRotation = Math.min(maxRight, upRotation + dUp);
    } else if (dUp < 0) {
        upRotation = Math.max(minLeft, upRotation + dUp);
    }    
    updateViewMatrix(upRotation);

    // order of objects is based on translucency

    // draw the plane first
    drawObject(plane);

    // draw each of the cubes
    for (let cube of cubes) {
        // first translate the mv matrix
        let [mv, scale, dz, dx] = cube.slice(4);
        mat4.translate(mv, mv, [(dx + envDx) * elapsed / scale, 0, dz * elapsed / scale]);
        // check if mv makes the cube collide with tetrahedron
        checkCollision(mv);
        // then draw it
        drawObject(cube);
    }

    // draw the tetrahedron
    drawObject(tetra);

    //remove objects that are outside of camera
    for (let i = 0; i < cubes.length; i++) {
        let z = cubes[i][4][14];
        if (z < -0.3) {
            cubes.splice(i, 1);
            i--;
        }
        
    }
    
    // increase the score, update high score
    if (playing) {
        score += dScore;
        runTime += 1;
    }
    document.getElementById('score').innerHTML = "Score: " + Math.round(score);
    highScores[difficulty] = Math.max(score, highScores[difficulty]);
    document.getElementById('hs' + difficulty).innerHTML = "High Score (" + difficulty +"): " + Math.round(highScores[difficulty]);

    // increase the speed and dScore as we survive longer
    if (runTime % 100 === 0) {
        dScore *= 1.025;
        // max becuase they're negative
        speed = Math.max(speed * 1.01, MAX_SPEED);
    }

    // re-render the scene
    window.requestAnimationFrame(render);


}


/**
 * Draws a single object
 */
function drawObject(obj) {
    let [vao, type, count, texture, mv] = obj;
    // bind VAO
    gl.bindVertexArray(vao);
    // select if it should be textured or not
    if (texture) {
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
        gl.uniform1i(gl.program.uTextured, 1);
    } else {
        gl.uniform1i(gl.program.uTextured, 0);
    }
    // send mv matrix to uniform
    gl.uniformMatrix4fv(gl.program.uModelViewMatrix, false, mv);
    // draw
    gl.drawElements(type, count, gl.UNSIGNED_SHORT, 0);
    // cleanup
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
}


/**
 * Checks if a cube collides with the tetrahedron based on mv
 */
function checkCollision(mv) {
    // helps with collision detection at high speeds
    let collisionOffset = -1 * speed * 0.04;

    // center (x, z) of the cube
    let centerX = mv[12];
    let centerZ = mv[14];

    // the three ground vertices of the tetrahedron
    let tetraPointZ = Math.sqrt(2) * TETRA_SCALE + collisionOffset;
    let tetraRightX = Math.sqrt(2/3) * TETRA_SCALE + collisionOffset;
    let tetraLeftX = -Math.sqrt(2/3) * TETRA_SCALE - collisionOffset;

    // the 4 ground vertices of the cube
    let baseZ = centerZ - CUBE_SCALE - collisionOffset;
    let backZ = centerZ + CUBE_SCALE + collisionOffset;
    let leftX = centerX - CUBE_SCALE - collisionOffset;
    let rightX = centerX + CUBE_SCALE + collisionOffset;

    // x0, x1, z0, and z1 are calculated from intersection of lines
    // if the (x, z) value is on both lines, then it intersects

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
    let z0 = leftX * Math.sqrt(3) + TETRA_SCALE * Math.sqrt(2);
    if (z0 >= -1 * collisionOffset && z0 <= tetraPointZ && z0 >= baseZ && z0 <= backZ) {
        playing = false;
    }
    let z1 = leftX * -Math.sqrt(3) + TETRA_SCALE * Math.sqrt(2);
    if (z1 >= -1 * collisionOffset && z1 <= tetraPointZ && z1 >= baseZ && z1 <= backZ) {
        playing = false;
    }

    // check if right line of cube intersects tetrahedron
    z0 = rightX * Math.sqrt(3) + TETRA_SCALE * Math.sqrt(2);
    if (z0 >= -1 * collisionOffset && z0 <= tetraPointZ && z0 >= baseZ && z0 <= backZ) {
        playing = false;
    }
    z1 = rightX * -Math.sqrt(3) + TETRA_SCALE * Math.sqrt(2);
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

/**
 * Creates and updates the projection matrix
 */
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

/**
 * Changes the view matrix based on the up angle
 */
function updateViewMatrix(angle) {

    // calculates the rotation matrix for the angle rotating around z-axis
    let rotation = mat4.fromRotation(mat4.create(), angle, [0, 0, 1]);

    // calculates the new up vector
    let thisUp = vec3.transformMat4(vec3.create(), up, rotation)

    // calculates and updates the new view matrix
    let viewMatrix = mat4.lookAt(mat4.create(), eye, horizon, thisUp);
    gl.uniformMatrix4fv(gl.program.uViewMatrix, false, viewMatrix);
}

/**
 * Fires whenever a key is pressed, controls motion
 */
function onKeyDown(e) {
    // add listener for when the key is raised
    window.addEventListener('keyup', onKeyUp);

    // if we are playing and press right
    if (e.keyCode === 37 && playing) {
        e.preventDefault();
        // move right
        envDx = -1 / 150;
        // angle environment to right
        maxRight = 0.1;
        minLeft = 0;
        dUp = 0.01
    // if we are playing and press left
    } else if (e.keyCode === 39 && playing) {
        e.preventDefault();
        // move left
        envDx = 1 / 150;
        // angle environment to left
        minLeft = -0.1;
        maxRight = 0;
        dUp = -0.01;
    // if we press r
    } else if (e.keyCode === 82) {
        restart();
    }

}

/**
 * Fires whenever a key is raised
 */
function onKeyUp(e) {

    // if we release right
    if (e.keyCode === 37 && playing) {
        e.preventDefault();
        // stop moving
        envDx = 0;
        // return angle to straight up
        maxRight = 0;
        minLeft = 0;
        dUp = -0.01;
    // if we release left
    } else if (e.keyCode === 39 && playing) {
        e.preventDefault();
        // stop moving
        envDx = 0;
        // return angle to straight up
        minLeft = 0;
        maxRight = 0;
        dUp = 0.01;
    }

    // don't listen for keyUp anymore
    window.removeEventListener('keyUp', onKeyUp);

}
