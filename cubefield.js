// Cubefield Game
// Based on https://www.cubefield.org.uk/
'use strict';

// Global WebGL context variable
let gl;

let objs = [];

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

    // set to size of window
    onWindowResize();

    // TODO: Set initial values of uniforms

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

        // uniform mat4 uModelViewMatrix;
        // uniform mat4 uProjectionMatrix;

        in vec4 aPosition;
        in vec3 aNormal;
        in vec3 aColor;

        vec4 lightPosition = vec4(0.0, 0.0, -1.0, 0.0);

        out vec3 vNormalVector;
        out vec3 vLightVector;
        out vec3 vEyeVector;
        flat out vec3 vColor;
        
        void main() {

            // vec4 P = uModelViewMatrix * aPosition
            vec4 P = aPosition;

            // vNormalVector = mat3(uModelViewMatrix) * aNormal;
            vNormalVector = aNormal;
            vLightVector = lightPosition.xyz;
            vEyeVector = -P.xyz;

            // gl_Position = uProjectionMatrix * P;
            gl_Position = P;
            vColor = aColor;
        }`
    );
    let frag_shader = compileShader(gl, gl.FRAGMENT_SHADER,
        `#version 300 es
        precision mediump float;

        // Material properties
        const vec3 lightColor = vec3(1.0, 1.0, 1.0);
        const float materialAmbient = 0.2;
        const float materialDiffuse = 0.4;
        const float materialSpecular = 0.6;
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
    
    return program;
}

function initBuffers() {
    // create buffers for cube/tetrahedron data
    // create buffer for horizon

    let tetraCoords = [
        0, 0, -1,
        0, Math.sqrt(8/9), 1/3,
        Math.sqrt(2/3), -Math.sqrt(2/9), 1/3,
        -Math.sqrt(2/3), -Math.sqrt(2/9), 1/3,
    ];
    let tetraColors = [
        1, 0, 0, // red
        0, 1, 0, // green
        0, 0, 1, // blue
        0, 0, 0 // black
    ];
    let tetraIndices = [
        3, 1, 0, // red triangle
        2, 0, 1, // green triangle
        0, 3, 2, // blue triangle
        1, 2, 3 // black triangle
    ];

    let tetraNormals = calc_normals(Float32Array.from(tetraCoords), tetraIndices, false);

    objs.push([createVao(gl, [
        [gl.program.aPosition, tetraCoords, 3], 
        [gl.program.aColor, tetraColors, 3],
        [gl.program.aNormal, tetraNormals, 3]
    ], tetraIndices), gl.TRIANGLES, 12]);


}

/**
 * Initialize event handlers
 */
function initEvents() {

    //add listeners

    window.addEventListener('resize', onWindowResize);

    // TODO: add listeners for keyboard input

}

/**
 * Render the scene.
 */
function render() {
    // Clear the current rendering
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // TODO: draw cubes and tetrahedron
    // add animation

    for (let [vao, type, count, mv] of objs) {
        gl.bindVertexArray(vao);
        gl.drawElements(type, count, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
    }


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

}

// This will do the work of updating matrices according to input
function onKeyboardInput() {

}