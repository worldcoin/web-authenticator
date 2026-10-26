export interface FaceGeometry {
  center: [number, number]; iod: number;
  boxLeft: number; boxTop: number; boxRight: number; boxBottom: number;
}
export function faceGeometry(landmarks: Float32Array, width: number, height: number): FaceGeometry | null;
export function headAngles(matrix: number[] | Float32Array | null): { yaw: number | null; pitch: number | null };

