// Cubefield Game
// Based on https://www.cubefield.org.uk/
'use strict';

// Global WebGL context variable
let gl;

// Allow use of glMatrix values directly instead of needing the glMatrix prefix
const vec3 = glMatrix.vec3;
const vec4 = glMatrix.vec4;
const mat4 = glMatrix.mat4;
const quat = glMatrix.quat;


// stores all the objects we have
let staticObjects = [];
let dynamicObjects = [];

let planeScale = 2.5;
let tetraScale = 0.1;

// allocate matrices globally
let projectionMatrix = mat4.create();


let eye = vec3.fromValues(0, 1, -1.5);
let horizon = vec3.fromValues(0, 0, 0.5);

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

    setStaticObjects();
    setDynamicObjects();

    // set to size of window
    onWindowResize();

    // TODO: Set initial values of uniforms
    let viewMatrix = mat4.lookAt(mat4.create(), eye, horizon, [0, 1, 2]);
    gl.uniformMatrix4fv(gl.program.uViewMatrix, false, viewMatrix);

    //Render initial scene
    render();
    
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

        vec4 lightPosition = vec4(0.0, 10.0, 0.0, 0.0);

        out vec3 vNormalVector;
        out vec3 vLightVector;
        out vec3 vEyeVector;
        flat out vec3 vColor;
        
        void main() {

            mat4 mv = uViewMatrix * uModelViewMatrix;

            vec4 light = mv * lightPosition;

            vec4 P = mv * aPosition;

            vNormalVector = mat3(uModelViewMatrix) * aNormal;
            vLightVector = light.xyz;
            vEyeVector = -P.xyz;

            gl_Position = uProjectionMatrix * P;
            vColor = aColor;
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
            
            // Compute final color
            fragColor.rgb =
                ((materialAmbient + materialDiffuse * diffuse) * vColor
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

    // Get the uniform indices
    program.uProjectionMatrix = gl.getUniformLocation(program, 'uProjectionMatrix');
    program.uModelViewMatrix = gl.getUniformLocation(program, 'uModelViewMatrix');
    program.uViewMatrix = gl.getUniformLocation(program, 'uViewMatrix');
    
    return program;
}


// this is very messy right now, needs some cleanup
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
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1
    ];
    let cubeNormals = calc_normals(Float32Array.from(cubeCoords), cubeIndices, false);
    let cubeMV = mat4.fromTranslation(mat4.create(), [0, 0.1, 1]);
    mat4.scale(cubeMV, cubeMV, [0.1, 0.1, 0.1]);
    gl.cubeVao = createVao(gl, [
        [gl.program.aPosition, cubeCoords, 3],
        [gl.program.aColor, cubeColors, 3],
        [gl.program.aNormal, cubeNormals, 3]
    ], cubeIndices); //, gl.TRIANGLES, 36, cubeMV]);

    // The vertices, colors, and indices for a tetrahedron
    let tetraCoords = [
        0, 0, 1,
        0, Math.sqrt(8/9), -1/3,
        Math.sqrt(2/3), -Math.sqrt(2/9), -1/3,
        -Math.sqrt(2/3), -Math.sqrt(2/9), -1/3,
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
function generateObject(z) {
    let mv = mat4.scale(mat4.create(), mat4.create(), [.05, .05, .05]);
    mat4.translate(mv, mv, [(Math.random()-.5)*24, 1, 2 + z]);
    // allows for flexibility if we make levels with moving cubes
    dynamicObjects.push([gl.cubeVao, gl.TRIANGLES, 36, mv, .1, -1 / 10000, 0]);

}
function setDynamicObjects() {
    let z = 5
    while(z < 50) {
        generateObject(z)
        z += .6
    }
}

function setStaticObjects() {
    let mv = mat4.scale(mat4.create(), mat4.create(), [planeScale, planeScale, planeScale]);
    staticObjects.push([gl.planeVao, gl.TRIANGLE_STRIP, 4, mv]);

    staticObjects.push([gl.tetraVao, gl.TRIANGLE_STRIP, 6, setTetraMvMatrix()]);
}

/**
 * Initialize event handlers
 */
function initEvents() {

    //add listeners

    window.addEventListener('resize', onWindowResize);

    // TODO: add listeners for keyboard input

    window.addEventListener('keydown', onKeyDown);

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

    // add animation
    if (!ms) { ms = last_redraw = performance.now(); }
    elapsed = ms - last_redraw;
    last_redraw = ms;
    
    last_object += elapsed
    if(last_object > 600) {
        last_object -= 600
        generateObject(50 + ms/1000)
    } 

    // TODO: draw better
    for (let [vao, type, count, mv, scale, dz, dx] of dynamicObjects) {
        gl.bindVertexArray(vao);
        mat4.translate(mv, mv, [dx * elapsed / scale, 0, dz * elapsed / scale]);
        gl.uniformMatrix4fv(gl.program.uModelViewMatrix, false, mv);
        gl.drawElements(type, count, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }

    for (let [vao, type, count, mv] of staticObjects) {
        gl.bindVertexArray(vao);
        gl.uniformMatrix4fv(gl.program.uModelViewMatrix, false, mv);
        gl.drawElements(type, count, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }

    window.requestAnimationFrame(render);


}

/**
 * Keep the canvas sized to the window.
 */
function onWindowResize() {
    // TODO: projection needs to be updated
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

// This will do the work of updating stuff according to input
function onKeyDown(e) {
    window.addEventListener('keyup', onKeyUp);

    if (e.keyCode === 37) {
        e.preventDefault();
        // move right
        for (let obj of dynamicObjects) {
            obj[6] = -1 / 800;
        }
    } else if (e.keyCode === 39) {
        e.preventDefault();
        // move left
        for (let obj of dynamicObjects) {
            obj[6] = 1 / 800;
        }
    }

}

function onKeyUp(e) {

    if (e.keyCode === 37) {
        e.preventDefault();
        // move right
        for (let obj of dynamicObjects) {
            obj[6] = 0;
        }
    } else if (e.keyCode === 39) {
        e.preventDefault();
        // move left
        for (let obj of dynamicObjects) {
            obj[6] = 0;
        }
    }

    window.removeEventListener('keyUp', onKeyUp);

}

// this probably needs improvement
function setTetraMvMatrix() {

    let mv = mat4.create();
    mat4.translate(mv, mv, [0, 0, -0.5]);
    mat4.scale(mv, mv, [tetraScale, tetraScale, tetraScale]);
    return mv;

}