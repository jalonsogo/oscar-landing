/**
 * donut-scene.js
 * Self-contained Three.js WebGPU caustics scene.
 *
 * Usage:
 *   import { initScene } from './donut-scene.js';
 *   const { destroy } = await initScene( containerElement, config );
 *
 * `config` is the JSON produced by the Export Config button.
 * All keys are optional — omit any to use the default value.
 */

import * as THREE from 'three/webgpu';
import {
	uniform, refract, div, frameId, lightViewPosition,
	float, positionView, positionViewDirection, screenUV, pass,
	texture3D, time, screenCoordinate, normalView, texture,
	Fn, vec2, vec3
} from 'three/tsl';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise }  from 'three/addons/math/ImprovedNoise.js';
import { bayer16 }        from 'three/addons/tsl/math/Bayer.js';
import { bloom }          from 'three/addons/tsl/display/BloomNode.js';
import { dof }            from 'three/addons/tsl/display/DepthOfFieldNode.js';

// ---------------------------------------------------------------------------
// Defaults — matches the initial state of the editor
// ---------------------------------------------------------------------------
const DEFAULTS = {
	camera:    { position: [ -0.55, 0.45, 0.65 ], target: [ 0, 0.1, 0 ] },
	object:    { shape: 'donut', position: [ 0, 0.26, 0 ], rotation: [ 0, 0, 0 ] },
	animation: { autoSpin: true, spinSpeed: 0.008 },
	lights: {
		ambient: { color: '#ffffff', intensity: 1 },
		spot:    { color: '#ffffff', intensity: 1 }
	},
	ground: { color: '#ffffff' }
};

function merge( defaults, overrides ) {
	const out = {};
	for ( const k of new Set( [ ...Object.keys( defaults ), ...Object.keys( overrides || {} ) ] ) ) {
		const d = defaults[ k ], o = ( overrides || {} )[ k ];
		out[ k ] = ( d && typeof d === 'object' && !Array.isArray( d ) )
			? merge( d, o )
			: ( o !== undefined ? o : d );
	}
	return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createCausticTexture() {
	const size = 512;
	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	const img = ctx.createImageData( size, size );
	const d   = img.data;
	for ( let y = 0; y < size; y++ ) {
		for ( let x = 0; x < size; x++ ) {
			const u = ( x / size ) * Math.PI * 6;
			const v = ( y / size ) * Math.PI * 6;
			let val =
				Math.sin( u * 1.3 + Math.sin( v * 1.1 ) * 2.2 ) +
				Math.sin( v * 1.7 + Math.sin( u * 1.5 ) * 1.8 ) +
				Math.sin( ( u + v ) * 1.1 + Math.cos( u * 1.4 - v * 0.9 ) * 2.0 );
			val = Math.min( 1, Math.pow( ( val + 3 ) / 6, 5 ) * 6 );
			const i = ( y * size + x ) * 4;
			d[ i ] = d[ i + 1 ] = d[ i + 2 ] = val * 255;
			d[ i + 3 ] = 255;
		}
	}
	ctx.putImageData( img, 0, 0 );
	const tex = new THREE.CanvasTexture( canvas );
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function createTexture3D() {
	const size = 128, repeat = 5, scale = 10;
	const data  = new Uint8Array( size * size * size );
	const perlin = new ImprovedNoise();
	let i = 0;
	for ( let z = 0; z < size; z++ )
		for ( let y = 0; y < size; y++ )
			for ( let x = 0; x < size; x++ )
				data[ i++ ] = 128 + 128 * perlin.noise(
					( x / size ) * repeat * scale,
					( y / size ) * repeat * scale,
					( z / size ) * repeat * scale
				);
	const tex = new THREE.Data3DTexture( data, size, size, size );
	tex.format = THREE.RedFormat;
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.unpackAlignment = 1;
	tex.needsUpdate = true;
	return tex;
}

function buildRingGeo() {
	const shape = new THREE.Shape();
	shape.absarc( 0, 0, 0.15, 0, Math.PI * 2, false );
	const hole = new THREE.Path();
	hole.absarc( 0, 0, 0.09, 0, Math.PI * 2, true );
	shape.holes.push( hole );
	const geo = new THREE.ExtrudeGeometry( shape, {
		depth: 0.022, bevelEnabled: true,
		bevelSegments: 10, bevelSize: 0.007,
		bevelThickness: 0.007, steps: 1, curveSegments: 160
	} );
	geo.center();
	geo.rotateX( - Math.PI / 2 );
	return geo;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function initScene( container, userConfig = {} ) {

	const cfg = merge( DEFAULTS, userConfig );
	const LAYER_VOL = 10;

	// --- Camera ---
	const [ cx, cy, cz ] = cfg.camera.position;
	const [ tx, ty, tz ] = cfg.camera.target;

	const camera = new THREE.PerspectiveCamera(
		35, container.clientWidth / container.clientHeight, 0.025, 5
	);
	camera.position.set( cx, cy, cz );

	// --- Scene ---
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( cfg.ground.color );
	scene.fog = new THREE.Fog( cfg.ground.color, 1.2, 2.8 );

	// --- Lights ---
	const ambientLight = new THREE.AmbientLight( cfg.lights.ambient.color, cfg.lights.ambient.intensity );
	scene.add( ambientLight );

	const spotLight = new THREE.SpotLight( cfg.lights.spot.color, cfg.lights.spot.intensity );
	spotLight.position.set( 0.2, 0.45, 0.15 );
	spotLight.castShadow      = true;
	spotLight.angle           = Math.PI / 6;
	spotLight.penumbra        = 1;
	spotLight.decay           = 2;
	spotLight.distance        = 0;
	spotLight.shadow.mapType  = THREE.HalfFloatType;
	spotLight.shadow.mapSize.set( 1024, 1024 );
	spotLight.shadow.camera.near = 0.1;
	spotLight.shadow.camera.far  = 1;
	spotLight.shadow.intensity   = Math.min( 1, cfg.lights.spot.intensity / 10 );
	spotLight.layers.enable( LAYER_VOL );
	scene.add( spotLight );

	// --- Geometries ---
	const geoDonut = new THREE.TorusGeometry( 0.12, 0.048, 192, 192 );
	const geoRing  = buildRingGeo();

	// --- Material ---
	const causticMap = createCausticTexture();
	const mat = new THREE.MeshPhysicalNodeMaterial();
	mat.side         = THREE.DoubleSide;
	mat.transparent  = true;
	mat.color        = new THREE.Color( 0xffffff );
	mat.transmission = 1;
	mat.thickness    = 0.1;
	mat.ior          = 1.52;
	mat.metalness    = 0;
	mat.roughness    = 0.04;

	const causticOcclusion = uniform( 1.2 );
	const causticEffect = Fn( () => {
		const refVec  = refract( positionViewDirection.negate(), normalView, div( 1.0, mat.ior ) ).normalize();
		const viewZ   = normalView.z.pow( causticOcclusion );
		const uvCoord = refVec.xy.mul( 0.6 );
		const causticColor = uniform( mat.color );
		const ab  = normalView.z.pow( - 0.9 ).mul( 0.004 );
		const proj = vec3(
			texture( causticMap, uvCoord.add( vec2( ab.negate(), 0 ) ) ).r,
			texture( causticMap, uvCoord.add( vec2( 0, ab.negate() ) ) ).g,
			texture( causticMap, uvCoord.add( vec2( ab, ab ) ) ).b
		);
		return proj.mul( viewZ.mul( 60 ) ).add( viewZ ).mul( causticColor );
	} )().toVar();

	mat.castShadowNode = causticEffect;
	mat.emissiveNode   = Fn( () => {
		const half = lightViewPosition( spotLight ).sub( positionView ).normalize();
		const dot  = float( positionViewDirection.dot( half.negate() ).saturate().pow( float( 3.0 ) ) );
		return causticEffect.mul( dot.add( 0.1 ) ).mul( 0.025 );
	} )();

	// --- Object ---
	const [ ox, oy, oz ] = cfg.object.position;
	const [ rx, ry, rz ] = cfg.object.rotation;
	const mesh = new THREE.Mesh( cfg.object.shape === 'ring' ? geoRing : geoDonut, mat );
	mesh.position.set( ox, oy, oz );
	mesh.rotation.set( rx, ry, rz );
	mesh.castShadow = true;
	scene.add( mesh );

	// --- Ground ---
	const groundMat = new THREE.MeshStandardMaterial( { color: cfg.ground.color, roughness: 1, metalness: 0 } );
	const ground = new THREE.Mesh( new THREE.PlaneGeometry( 8, 8 ), groundMat );
	ground.rotation.x    = - Math.PI / 2;
	ground.receiveShadow = true;
	scene.add( ground );

	// --- Renderer ---
	const renderer = new THREE.WebGPURenderer( { antialias: true } );
	renderer.shadowMap.enabled    = true;
	renderer.shadowMap.transmitted = true;
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( container.clientWidth, container.clientHeight );
	container.appendChild( renderer.domElement );

	// --- Volumetric fog ---
	const noiseTexture3D = createTexture3D();
	const smokeAmountU   = uniform( cfg.fog?.smokeAmount ?? 3 );
	const fogColorU      = uniform( new THREE.Color( cfg.fog?.color ?? '#ffffff' ) );
	const volumetricMat  = new THREE.VolumeNodeMaterial();
	volumetricMat.steps      = 20;
	volumetricMat.offsetNode = bayer16( screenCoordinate.add( frameId ) );
	volumetricMat.scatteringNode = Fn( ( { positionRay } ) => {
		const drift = vec3( time.mul( 0.01 ), 0, time.mul( 0.03 ) );
		const grain = ( s, t = 1 ) =>
			texture3D( noiseTexture3D, positionRay.add( drift.mul( t ) ).mul( s ).mod( 1 ), 0 ).r.add( 0.5 );
		let density = grain( 1 );
		density = density.mul( grain( 0.5, 1 ) );
		density = density.mul( grain( 0.2, 2 ) );
		return smokeAmountU.mix( 1, density ).mul( fogColorU );
	} );

	const volLayer = new THREE.Layers();
	volLayer.disableAll();
	volLayer.enable( LAYER_VOL );

	const volumetricMesh = new THREE.Mesh( new THREE.BoxGeometry( 1.5, 0.5, 1.5 ), volumetricMat );
	volumetricMesh.receiveShadow = true;
	volumetricMesh.position.y   = 0.38;
	volumetricMesh.layers.disableAll();
	volumetricMesh.layers.enable( LAYER_VOL );
	scene.add( volumetricMesh );

	// --- Post-processing ---
	const renderPipeline = new THREE.RenderPipeline( renderer );
	const scenePass  = pass( scene, camera );
	const sceneDepth = scenePass.getTextureNode( 'depth' );
	volumetricMat.depthNode = sceneDepth.sample( screenUV );

	const volPass = pass( scene, camera, { depthBuffer: false, samples: 0 } );
	volPass.setLayers( volLayer );
	volPass.setResolutionScale( 0.5 );

	const bloomPass    = bloom( volPass, 1, 1, 0 );
	const volIntensity = uniform( 0.7 );
	const dofPass = dof( scenePass, scenePass.getViewZNode(), 0.75, 0.2, cfg.dof?.bokehScale ?? 1.5 );
	renderPipeline.outputNode = dofPass.add( bloomPass.mul( volIntensity ) );

	// --- Controls ---
	const controls = new OrbitControls( camera, renderer.domElement );
	controls.target.set( tx, ty, tz );
	controls.maxDistance = 2;
	controls.update();

	// --- Resize ---
	const resizeObserver = new ResizeObserver( () => {
		const w = container.clientWidth, h = container.clientHeight;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize( w, h );
	} );
	resizeObserver.observe( container );

	// --- Loop ---
	const { autoSpin, spinSpeed } = cfg.animation;
	let spinning = autoSpin;
	let speed    = spinSpeed;

	renderer.setAnimationLoop( () => {
		if ( spinning ) {
			const t = Date.now() * ( speed / 0.008 ) * 0.0004;
			mesh.rotation.y -= speed;
			mesh.rotation.x  = Math.sin( t ) * 0.3;
		}
		controls.update();
		renderPipeline.render();
	} );

	// --- Public API ---
	return {
		/** Stop the animation loop and remove the canvas. */
		destroy() {
			renderer.setAnimationLoop( null );
			resizeObserver.disconnect();
			renderer.dispose();
			renderer.domElement.remove();
		},
		/** Pause / resume the auto-spin. */
		setAutoSpin( v ) { spinning = v; },
		/** Change spin speed at runtime. */
		setSpinSpeed( v ) { speed = v; }
	};
}
